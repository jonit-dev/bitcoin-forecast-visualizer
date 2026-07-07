import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { intervalCoverage, pinballLoss } from '../src/lib/backtestMetrics';
import { FEATURE_FAMILIES, type FeatureFamily } from '../src/lib/featureExperimentDataset';
import { getFeatureRows, type FeatureRow } from '../src/lib/features';
import { RESIDUAL_MODEL_CONFIG } from '../src/lib/modelConfig';
import { powerLawForecast } from '../src/lib/powerLaw';
import { fitRidgeResidualModel, predictRidgeResidual, type ResidualTrainingRow } from '../src/lib/residualModel';

interface ResidualRow extends ResidualTrainingRow {
  targetDate: string;
  baselineMedian: number;
  actualClose: number;
  sourceDates: Record<string, string>;
}

interface EvaluationRow {
  originDate: string;
  targetDate: string;
  trainingEndDate: string;
  trainingRows: number;
  selectedFeatures: string[];
  actualResidualLog: number;
  baselinePrediction: number;
  modelPrediction: number;
  baselinePinballLoss: number;
  modelPinballLoss: number;
  baselineCovered80: boolean;
  modelCovered80: boolean;
}

interface MetricSummary {
  samples: number;
  meanPinballLoss: number | null;
  medianAbsResidualError: number | null;
  bias: number | null;
  coverage80: number | null;
}

interface HorizonReport {
  holdoutStart: string;
  horizonDays: number;
  status: 'disabled-negative-result' | 'watch' | 'eligible-for-manual-review' | 'sample-starved';
  reason: string;
  baseline: MetricSummary;
  model: MetricSummary;
  improvement: {
    meanPinballLoss: number | null;
    coverageDelta80: number | null;
  };
  evaluations: EvaluationRow[];
}

const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_ROWS = getFeatureRows();
const FEATURE_BY_DATE = new Map(FEATURE_ROWS.map(row => [row.date, row]));
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const ALL_FEATURE_NAMES = Object.values(FEATURE_FAMILIES).flatMap(spec => spec.featureNames);
const MAX_FEATURES = 24;

function main(): void {
  const reports = RESIDUAL_MODEL_CONFIG.holdoutStarts.flatMap(holdoutStart =>
    RESIDUAL_MODEL_CONFIG.horizons.map(horizonDays => evaluateHorizon(holdoutStart, horizonDays))
  );
  const enabled = reports.some(report => report.status === 'eligible-for-manual-review');
  const report = {
    metadata: {
      generatedAt: new Date().toISOString(),
      command: 'npm run backtest:residual-model',
      gitCommit: gitCommit(),
      modelId: RESIDUAL_MODEL_CONFIG.modelId,
      defaultEnabled: RESIDUAL_MODEL_CONFIG.defaultEnabled,
      lambda: RESIDUAL_MODEL_CONFIG.lambda,
      minimumTrainingRows: RESIDUAL_MODEL_CONFIG.minimumTrainingRows,
      evaluationSpacingDays: RESIDUAL_MODEL_CONFIG.evaluationSpacingDays,
      holdoutStarts: RESIDUAL_MODEL_CONFIG.holdoutStarts,
      horizons: RESIDUAL_MODEL_CONFIG.horizons,
      promotionPolicy: RESIDUAL_MODEL_CONFIG.promotionPolicy,
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
      featureRows: FEATURE_ROWS.length,
      featureFirstDate: FEATURE_ROWS[0]?.date,
      featureLastDate: FEATURE_ROWS.at(-1)?.date,
    },
    verdict: enabled ? 'eligible-for-manual-review' : 'disabled-negative-result',
    verdictReason: enabled
      ? 'At least one horizon has positive residual-model pinball improvement without 80% coverage degradation; still disabled pending manual review.'
      : 'Kitchen-sink feature residual model did not beat pure residual decay broadly enough to enable new alpha.',
    reports,
  };
  writeReport(report);
}

function evaluateHorizon(holdoutStart: string, horizonDays: number): HorizonReport {
  const rows = buildRows(horizonDays);
  const evaluations: EvaluationRow[] = [];

  for (let i = 0; i < rows.length; i += RESIDUAL_MODEL_CONFIG.evaluationSpacingDays) {
    const evalRow = rows[i];
    if (evalRow.originDate < holdoutStart) continue;
    const trainPool = rows.filter(row => row.originDate < evalRow.originDate);
    const selectedFeatures = selectFeatures(trainPool, evalRow);
    const trainingRows = trainPool
      .filter(row => selectedFeatures.every(name => Number.isFinite(row.features[name])))
      .map(row => ({ originDate: row.originDate, targetResidualLog: row.targetResidualLog, features: row.features }));
    if (trainingRows.length < RESIDUAL_MODEL_CONFIG.minimumTrainingRows || selectedFeatures.length === 0) continue;
    const trainingEndDate = trainingRows.at(-1)?.originDate ?? '';
    const model = fitRidgeResidualModel({
      rows: trainingRows,
      featureNames: selectedFeatures,
      lambda: RESIDUAL_MODEL_CONFIG.lambda,
      trainingEndDate,
    });
    if (!model) continue;
    const modelPrediction = predictRidgeResidual(model, evalRow.features);
    if (modelPrediction === null) continue;
    const baselineDistribution = summarizeResiduals(trainingRows.map(row => row.targetResidualLog));
    const modelResiduals = trainingRows
      .map(row => {
        const predicted = predictRidgeResidual(model, row.features);
        return predicted === null ? null : row.targetResidualLog - predicted;
      })
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const modelDistribution = summarizeResiduals(modelResiduals);
    evaluations.push({
      originDate: evalRow.originDate,
      targetDate: evalRow.targetDate,
      trainingEndDate: model.trainingEndDate,
      trainingRows: model.trainingRows,
      selectedFeatures,
      actualResidualLog: evalRow.targetResidualLog,
      baselinePrediction: 0,
      modelPrediction,
      baselinePinballLoss: meanPinball(evalRow.targetResidualLog, 0, baselineDistribution),
      modelPinballLoss: meanPinball(evalRow.targetResidualLog, modelPrediction, modelDistribution),
      baselineCovered80: intervalCoverage(evalRow.targetResidualLog, baselineDistribution.q10, baselineDistribution.q90),
      modelCovered80: intervalCoverage(evalRow.targetResidualLog, modelPrediction + modelDistribution.q10, modelPrediction + modelDistribution.q90),
    });
  }

  const baseline = summarizeMetrics(evaluations, 'baseline');
  const model = summarizeMetrics(evaluations, 'model');
  const meanImprovement = nullableDiff(baseline.meanPinballLoss, model.meanPinballLoss);
  const coverageDelta = nullableDiff(model.coverage80, baseline.coverage80);
  const status = classifyStatus(evaluations.length, meanImprovement, coverageDelta);
  return {
    holdoutStart,
    horizonDays,
    status: status.status,
    reason: status.reason,
    baseline,
    model,
    improvement: {
      meanPinballLoss: meanImprovement,
      coverageDelta80: coverageDelta,
    },
    evaluations,
  };
}

function buildRows(horizonDays: number): ResidualRow[] {
  const rows: ResidualRow[] = [];
  for (let originIndex = 365; originIndex + horizonDays < BTC_ROWS.length; originIndex++) {
    const origin = BTC_ROWS[originIndex];
    const target = BTC_ROWS[originIndex + horizonDays];
    const featureRow = FEATURE_BY_DATE.get(origin.date);
    if (!featureRow) continue;
    const baselineMedian = powerLawForecast(parseDate(target.date), origin.close, parseDate(origin.date));
    if (!Number.isFinite(baselineMedian) || baselineMedian <= 0 || target.close <= 0) continue;
    rows.push({
      originDate: origin.date,
      targetDate: target.date,
      actualClose: target.close,
      baselineMedian,
      targetResidualLog: Math.log(target.close / baselineMedian),
      features: featureRow.features,
      sourceDates: featureRow.sourceDates,
    });
  }
  return rows;
}

function selectFeatures(trainPool: ResidualRow[], evalRow: ResidualRow): string[] {
  const candidates = ALL_FEATURE_NAMES
    .filter(name => Number.isFinite(evalRow.features[name]) && isLagSafe(evalRow, name))
    .map(name => {
      const finiteRows = trainPool.filter(row => Number.isFinite(row.features[name]) && isLagSafe(row, name));
      return { name, count: finiteRows.length, variance: variance(finiteRows.map(row => row.features[name])) ?? 0 };
    })
    .filter(item => item.count >= RESIDUAL_MODEL_CONFIG.minimumTrainingRows && item.variance > 0)
    .sort((a, b) => b.count - a.count || b.variance - a.variance)
    .map(item => item.name);

  let selected = candidates.slice(0, MAX_FEATURES);
  while (selected.length > 0) {
    const completeRows = trainPool.filter(row => selected.every(name => Number.isFinite(row.features[name]) && isLagSafe(row, name)));
    if (completeRows.length >= RESIDUAL_MODEL_CONFIG.minimumTrainingRows) return selected;
    selected = selected.slice(0, -1);
  }
  return [];
}

function summarizeMetrics(evaluations: EvaluationRow[], side: 'baseline' | 'model'): MetricSummary {
  const losses = evaluations.map(row => side === 'baseline' ? row.baselinePinballLoss : row.modelPinballLoss);
  const errors = evaluations.map(row => (side === 'baseline' ? row.baselinePrediction : row.modelPrediction) - row.actualResidualLog);
  const covered = evaluations.map(row => side === 'baseline' ? row.baselineCovered80 : row.modelCovered80);
  return {
    samples: evaluations.length,
    meanPinballLoss: mean(losses),
    medianAbsResidualError: median(errors.map(Math.abs)),
    bias: mean(errors),
    coverage80: covered.length > 0 ? covered.filter(Boolean).length / covered.length : null,
  };
}

function classifyStatus(
  samples: number,
  meanImprovement: number | null,
  coverageDelta: number | null
): { status: HorizonReport['status']; reason: string } {
  if (samples < 20) return { status: 'sample-starved', reason: `fewer than 20 spaced walk-forward evaluations (${samples})` };
  if ((meanImprovement ?? -Infinity) > 0 && (coverageDelta ?? 0) >= -0.03) {
    return { status: 'eligible-for-manual-review', reason: 'mean pinball loss improved without material 80% coverage degradation' };
  }
  if ((meanImprovement ?? -Infinity) > 0) {
    return { status: 'watch', reason: 'mean pinball improved, but 80% coverage degraded too much' };
  }
  return { status: 'disabled-negative-result', reason: 'kitchen-sink residual model did not beat pure residual decay' };
}

function writeReport(report: any): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.metadata.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `residual-model-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `residual-model-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`Residual model report: ${jsonPath}`);
  console.log(`Residual model markdown: ${mdPath}`);
  console.log(`Residual model verdict: ${report.verdict}`);
}

function renderMarkdown(report: any): string {
  const lines = [
    '# Kitchen-Sink Residual Model Report',
    '',
    `Generated: ${report.metadata.generatedAt}`,
    `Git commit: \`${report.metadata.gitCommit}\``,
    `Model: ${report.metadata.modelId}`,
    `Default enabled: ${report.metadata.defaultEnabled ? 'yes' : 'no'}`,
    `Promotion policy: ${report.metadata.promotionPolicy}`,
    '',
    `Verdict: **${report.verdict}**. ${report.verdictReason}`,
    '',
    '| Holdout | Horizon | Samples | Status | Baseline pinball | Model pinball | Improvement | Baseline cov80 | Model cov80 | Reason |',
    '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const item of report.reports as HorizonReport[]) {
    lines.push([
      `| ${item.holdoutStart}`,
      `${item.horizonDays}d`,
      item.model.samples,
      item.status,
      formatNumber(item.baseline.meanPinballLoss),
      formatNumber(item.model.meanPinballLoss),
      formatNumber(item.improvement.meanPinballLoss),
      formatNumber(item.baseline.coverage80),
      formatNumber(item.model.coverage80),
      item.reason,
      '|',
    ].join(' | '));
  }
  lines.push('', 'Every evaluation row in JSON includes `trainingEndDate` before `originDate`; random train/test splits are not used.', '');
  return `${lines.join('\n')}\n`;
}

function summarizeResiduals(values: number[]): { q10: number; q50: number; q90: number } {
  return {
    q10: quantile(values, 0.1) ?? 0,
    q50: quantile(values, 0.5) ?? 0,
    q90: quantile(values, 0.9) ?? 0,
  };
}

function meanPinball(actual: number, prediction: number, residuals: { q10: number; q50: number; q90: number }): number {
  return mean([
    pinballLoss(actual, prediction + residuals.q10, 0.1),
    pinballLoss(actual, prediction + residuals.q50, 0.5),
    pinballLoss(actual, prediction + residuals.q90, 0.9),
  ]) ?? 0;
}

function isLagSafe(row: Pick<ResidualRow, 'originDate' | 'sourceDates'>, featureName: string): boolean {
  const sourceDate = row.sourceDates[featureName];
  return !sourceDate || sourceDate < row.originDate;
}

function nullableDiff(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function variance(values: number[]): number | null {
  const avg = mean(values);
  if (avg === null) return null;
  return mean(values.map(value => (value - avg) ** 2));
}

function quantile(values: number[], q: number): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const index = (finite.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return finite[low];
  return finite[low] + (finite[high] - finite[low]) * (index - low);
}

function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(5);
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

main();
