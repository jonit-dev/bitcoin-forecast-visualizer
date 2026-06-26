import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { getBacktestModels } from '../src/lib/backtestModels';
import { normalQuantile } from '../src/lib/forecastInterval';

interface CandidateSpec {
  id: string;
  description: string;
  params: Record<string, number>;
  sigma: (originIndex: number, horizonDays: number, baselineSigma: number) => number | null;
}

interface MetricSummary {
  samples: number;
  nll: number | null;
  baselineNll: number | null;
  meanNllImprovement: number | null;
  bootstrapLower95NllImprovement: number | null;
  medianAbsLogError: number | null;
  coverage80: number | null;
  coverage90: number | null;
  coverage95: number | null;
  baselineCoverage90: number | null;
  pinballLoss: Record<'q05' | 'q10' | 'q90' | 'q95', number | null>;
  baselinePinballLoss: Record<'q05' | 'q10' | 'q90' | 'q95', number | null>;
  meanInterval90WidthLog: number | null;
  baselineInterval90WidthLog: number | null;
}

interface CandidateReport {
  id: string;
  description: string;
  params: Record<string, number>;
  validationThinned: Record<string, MetricSummary>;
  holdoutThinned: Record<string, MetricSummary>;
  verdict: 'promote' | 'candidate' | 'reject';
  verdictReason: string;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const VALIDATION_START = '2022-01-01';
const VALIDATION_END = '2024-12-31';
const HOLDOUT_START = '2025-01-01';
const HORIZONS = [7, 14, 30, 60];
const REQUIRED_HORIZONS = [7, 14, 30];
const BOOTSTRAP_ITERATIONS = 400;
const MIN_LOOKBACK = 365;
const QUANTILES = [
  ['q05', 0.05],
  ['q10', 0.10],
  ['q90', 0.90],
  ['q95', 0.95],
] as const;

function main(): void {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  if (!powerlaw) throw new Error('powerlaw-current model not found');

  const candidatePool = buildCandidatePool();
  const baseline = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluate(powerlaw, null, horizon, HOLDOUT_START, null, horizon),
  ]));

  const candidates: CandidateReport[] = HORIZONS.map(horizon => {
    const scored = candidatePool
      .map(candidate => ({
        candidate,
        metric: evaluate(powerlaw, candidate, horizon, VALIDATION_START, VALIDATION_END, horizon),
      }))
      .filter(item => item.metric.nll !== null)
      .sort((a, b) => (a.metric.nll ?? Infinity) - (b.metric.nll ?? Infinity));
    return scored[0]?.candidate;
  })
    .filter((candidate): candidate is CandidateSpec => Boolean(candidate))
    .filter((candidate, index, rows) => rows.findIndex(row => row.id === candidate.id) === index)
    .map(candidate => {
      const validationThinned = Object.fromEntries(HORIZONS.map(horizon => [
        String(horizon),
        evaluate(powerlaw, candidate, horizon, VALIDATION_START, VALIDATION_END, horizon),
      ]));
      const holdoutThinned = Object.fromEntries(HORIZONS.map(horizon => [
        String(horizon),
        evaluate(powerlaw, candidate, horizon, HOLDOUT_START, null, horizon),
      ]));
      const verdict = classifyVerdict(holdoutThinned);
      return {
        id: candidate.id,
        description: candidate.description,
        params: candidate.params,
        validationThinned,
        holdoutThinned,
        verdict: verdict.verdict,
        verdictReason: verdict.reason,
      };
    });

  const report = {
    generatedAt: new Date().toISOString(),
    data: {
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
    },
    preRegistration: {
      purpose: 'Research-only dynamic volatility experiment for power-law forecast intervals with unchanged median.',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest available target`,
      horizons: HORIZONS,
      requiredPromotionHorizons: REQUIRED_HORIZONS,
      baseline: 'powerlaw-current median and current computePowerLawInterval sigma',
      candidates: [
        'EWMA realized volatility with validation-selected decay and multiplier.',
        'HAR-style realized volatility from 7/30/90d components with validation-selected weights and multiplier.',
        'Volatility-of-volatility widening rule with validation-selected window and scale.',
        'Asymmetric widening after large downside moves with validation-selected lookback and scale.',
      ],
      modelForm: 'candidate median is unchanged; only sigma and derived lognormal quantiles change.',
      leakagePolicy: 'all realized-volatility inputs use BTC rows at or before the forecast origin.',
      promotionGate: 'final-holdout NLL improves on 7/14/30d with positive lower 95% block-bootstrap bounds, 90% coverage remains roughly 85-95%, and tail pinball does not worsen on both tails.',
    },
    baselineHoldoutThinned: baseline,
    selectedCandidates: candidates,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-dynamic-volatility-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-dynamic-volatility-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC dynamic volatility report: ${jsonPath}`);
  console.log(`BTC dynamic volatility markdown: ${mdPath}`);
  printSummary(candidates);
}

function buildCandidatePool(): CandidateSpec[] {
  const candidates: CandidateSpec[] = [];
  for (const lambda of [0.90, 0.94, 0.97, 0.985]) {
    for (const multiplier of [0.85, 1.00, 1.15, 1.30]) {
      candidates.push({
        id: `ewma-l${lambda}-m${multiplier}`,
        description: 'EWMA daily realized volatility scaled by mean-reverting horizon variance.',
        params: { lambda, multiplier },
        sigma: (originIndex, horizonDays) => {
          const dailyVol = ewmaVol(originIndex, lambda);
          return dailyVol === null ? null : multiplier * Math.sqrt(residualVarianceMultiplier(horizonDays)) * dailyVol;
        },
      });
    }
  }
  for (const w7 of [0.20, 0.35, 0.50]) {
    for (const w30 of [0.30, 0.45, 0.60]) {
      const w90 = 1 - w7 - w30;
      if (w90 < 0.10 || w90 > 0.50) continue;
      for (const multiplier of [0.85, 1.00, 1.15, 1.30]) {
        candidates.push({
          id: `har-w7${w7}-w30${w30}-m${multiplier}`,
          description: 'HAR-style blend of 7/30/90d realized volatility.',
          params: { w7, w30, w90, multiplier },
          sigma: (originIndex, horizonDays) => {
            const v7 = realizedVol(originIndex, 7);
            const v30 = realizedVol(originIndex, 30);
            const v90 = realizedVol(originIndex, 90);
            if (v7 === null || v30 === null || v90 === null) return null;
            const dailyVol = Math.sqrt(w7 * v7 * v7 + w30 * v30 * v30 + w90 * v90 * v90);
            return multiplier * Math.sqrt(residualVarianceMultiplier(horizonDays)) * dailyVol;
          },
        });
      }
    }
  }
  for (const lookback of [14, 30, 60]) {
    for (const scale of [0.25, 0.50, 0.75, 1.00]) {
      candidates.push({
        id: `vol-of-vol-lb${lookback}-s${scale}`,
        description: 'Baseline sigma widened when recent realized-volatility instability is elevated.',
        params: { lookback, scale },
        sigma: (originIndex, _horizonDays, baselineSigma) => {
          const ratio = volOfVolRatio(originIndex, lookback);
          if (ratio === null) return null;
          return baselineSigma * (1 + scale * Math.max(0, ratio - 1));
        },
      });
    }
  }
  for (const lookback of [7, 14, 30]) {
    for (const threshold of [-0.08, -0.12, -0.16]) {
      for (const scale of [0.20, 0.35, 0.50]) {
        candidates.push({
          id: `downside-lb${lookback}-t${Math.abs(threshold)}-s${scale}`,
          description: 'Baseline sigma widened asymmetrically after large downside moves.',
          params: { lookback, threshold, scale },
          sigma: (originIndex, _horizonDays, baselineSigma) => {
            const move = logMove(originIndex, lookback);
            if (move === null) return null;
            return baselineSigma * (move <= threshold ? 1 + scale : 1);
          },
        });
      }
    }
  }
  return candidates;
}

function evaluate(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  candidate: CandidateSpec | null,
  horizonDays: number,
  startDate: string,
  endDate: string | null,
  spacingDays: number
): MetricSummary {
  const nlls: number[] = [];
  const baselineNlls: number[] = [];
  const improvements: number[] = [];
  const absLogErrors: number[] = [];
  const cover80: number[] = [];
  const cover90: number[] = [];
  const cover95: number[] = [];
  const baseCover90: number[] = [];
  const widths90: number[] = [];
  const baseWidths90: number[] = [];
  const pinballLosses = Object.fromEntries(QUANTILES.map(([key]) => [key, [] as number[]])) as Record<'q05' | 'q10' | 'q90' | 'q95', number[]>;
  const basePinballLosses = Object.fromEntries(QUANTILES.map(([key]) => [key, [] as number[]])) as Record<'q05' | 'q10' | 'q90' | 'q95', number[]>;

  for (let originIndex = MIN_LOOKBACK; originIndex + horizonDays < BTC_ROWS.length; originIndex += spacingDays) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const forecast = powerlaw.forecast(BTC_ROWS, originIndex, horizonDays);
    if (!forecast?.sigma || !Number.isFinite(forecast.sigma) || forecast.sigma <= 0 || forecast.median <= 0) continue;
    const sigma = candidate ? candidate.sigma(originIndex, horizonDays, forecast.sigma) : forecast.sigma;
    if (!sigma || !Number.isFinite(sigma) || sigma <= 0) continue;

    const actualLog = Math.log(target.close);
    const medianLog = Math.log(forecast.median);
    const nll = normalNll(actualLog, medianLog, sigma);
    const baselineNll = normalNll(actualLog, medianLog, forecast.sigma);
    nlls.push(nll);
    baselineNlls.push(baselineNll);
    improvements.push(baselineNll - nll);
    absLogErrors.push(Math.abs(actualLog - medianLog));
    cover80.push(isCovered(actualLog, medianLog, sigma, 0.80) ? 1 : 0);
    cover90.push(isCovered(actualLog, medianLog, sigma, 0.90) ? 1 : 0);
    cover95.push(isCovered(actualLog, medianLog, sigma, 0.95) ? 1 : 0);
    baseCover90.push(isCovered(actualLog, medianLog, forecast.sigma, 0.90) ? 1 : 0);
    widths90.push(2 * sigma * normalQuantile(0.95));
    baseWidths90.push(2 * forecast.sigma * normalQuantile(0.95));
    for (const [key, q] of QUANTILES) {
      pinballLosses[key].push(pinballLogLoss(actualLog, medianLog + sigma * normalQuantile(q), q));
      basePinballLosses[key].push(pinballLogLoss(actualLog, medianLog + forecast.sigma * normalQuantile(q), q));
    }
  }

  return {
    samples: nlls.length,
    nll: mean(nlls),
    baselineNll: mean(baselineNlls),
    meanNllImprovement: mean(improvements),
    bootstrapLower95NllImprovement: bootstrapLower95(improvements, Math.max(1, horizonDays)),
    medianAbsLogError: median(absLogErrors),
    coverage80: mean(cover80),
    coverage90: mean(cover90),
    coverage95: mean(cover95),
    baselineCoverage90: mean(baseCover90),
    pinballLoss: mapMeans(pinballLosses),
    baselinePinballLoss: mapMeans(basePinballLosses),
    meanInterval90WidthLog: mean(widths90),
    baselineInterval90WidthLog: mean(baseWidths90),
  };
}

function classifyVerdict(holdout: Record<string, MetricSummary>): { verdict: CandidateReport['verdict']; reason: string } {
  const required = REQUIRED_HORIZONS.map(horizon => holdout[String(horizon)]);
  const nllPass = required.every(metric =>
    (metric.meanNllImprovement ?? -Infinity) > 0 &&
    (metric.bootstrapLower95NllImprovement ?? -Infinity) > 0
  );
  const coveragePass = required.every(metric => {
    const coverage = metric.coverage90;
    return coverage !== null && coverage >= 0.85 && coverage <= 0.95;
  });
  const pinballPass = required.every(metric => {
    const lowWorse = (metric.pinballLoss.q05 ?? Infinity) > (metric.baselinePinballLoss.q05 ?? -Infinity) &&
      (metric.pinballLoss.q10 ?? Infinity) > (metric.baselinePinballLoss.q10 ?? -Infinity);
    const highWorse = (metric.pinballLoss.q90 ?? Infinity) > (metric.baselinePinballLoss.q90 ?? -Infinity) &&
      (metric.pinballLoss.q95 ?? Infinity) > (metric.baselinePinballLoss.q95 ?? -Infinity);
    return !lowWorse && !highWorse;
  });

  if (nllPass && coveragePass && pinballPass) {
    return { verdict: 'promote', reason: 'Passed required holdout NLL, coverage, and tail pinball gates.' };
  }
  const anyImproved = required.some(metric => (metric.meanNllImprovement ?? -Infinity) > 0);
  if (anyImproved) {
    return { verdict: 'candidate', reason: 'Some holdout horizons improved, but the full promotion gate did not pass.' };
  }
  return { verdict: 'reject', reason: 'Did not improve required holdout NLL versus current interval baseline.' };
}

function realizedVol(originIndex: number, lookback: number): number | null {
  if (originIndex < lookback) return null;
  const returns = logReturns(originIndex, lookback);
  return stddev(returns);
}

function ewmaVol(originIndex: number, lambda: number): number | null {
  if (originIndex < 180) return null;
  const returns = logReturns(originIndex, Math.min(originIndex, 365));
  let variance = returns[0] ** 2;
  for (let i = 1; i < returns.length; i++) variance = lambda * variance + (1 - lambda) * returns[i] ** 2;
  return Math.sqrt(variance);
}

function volOfVolRatio(originIndex: number, lookback: number): number | null {
  if (originIndex < lookback * 4) return null;
  const recent = rollingAbsReturns(originIndex, lookback);
  const prior = rollingAbsReturns(originIndex - lookback, lookback * 3);
  const recentVol = stddev(recent);
  const priorVol = stddev(prior);
  return recentVol !== null && priorVol !== null && priorVol > 0 ? recentVol / priorVol : null;
}

function rollingAbsReturns(originIndex: number, lookback: number): number[] {
  return logReturns(originIndex, lookback).map(Math.abs);
}

function logMove(originIndex: number, lookback: number): number | null {
  if (originIndex < lookback) return null;
  return Math.log(BTC_ROWS[originIndex].close / BTC_ROWS[originIndex - lookback].close);
}

function logReturns(originIndex: number, lookback: number): number[] {
  const out: number[] = [];
  for (let i = originIndex - lookback + 1; i <= originIndex; i++) {
    out.push(Math.log(BTC_ROWS[i].close / BTC_ROWS[i - 1].close));
  }
  return out.filter(Number.isFinite);
}

function residualVarianceMultiplier(days: number): number {
  const residualDecay = Math.exp(-1 / 210);
  let varianceMultiplier = 0;
  let decayPowerSq = 1;
  for (let step = 0; step < days; step++) {
    varianceMultiplier += decayPowerSq;
    decayPowerSq *= residualDecay * residualDecay;
  }
  return varianceMultiplier;
}

function normalNll(x: number, meanValue: number, sd: number): number {
  return 0.5 * Math.log(2 * Math.PI * sd * sd) + ((x - meanValue) ** 2) / (2 * sd * sd);
}

function pinballLogLoss(actual: number, predicted: number, quantile: number): number {
  const error = actual - predicted;
  return Math.max(quantile * error, (quantile - 1) * error);
}

function isCovered(actualLog: number, medianLog: number, sigma: number, interval: number): boolean {
  const tail = (1 - interval) / 2;
  const lo = medianLog + sigma * normalQuantile(tail);
  const hi = medianLog + sigma * normalQuantile(1 - tail);
  return actualLog >= lo && actualLog <= hi;
}

function stddev(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const avg = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - avg) ** 2, 0) / finite.length;
  return Math.sqrt(variance);
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function median(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

function mapMeans(values: Record<'q05' | 'q10' | 'q90' | 'q95', number[]>): Record<'q05' | 'q10' | 'q90' | 'q95', number | null> {
  return {
    q05: mean(values.q05),
    q10: mean(values.q10),
    q90: mean(values.q90),
    q95: mean(values.q95),
  };
}

function bootstrapLower95(values: number[], blockLength: number): number | null {
  if (values.length < 10) return null;
  const samples: number[] = [];
  const blocks: number[][] = [];
  for (let i = 0; i < values.length; i += blockLength) blocks.push(values.slice(i, i + blockLength));
  for (let iter = 0; iter < BOOTSTRAP_ITERATIONS; iter++) {
    const sampled: number[] = [];
    while (sampled.length < values.length) {
      const block = blocks[Math.floor(random(iter, sampled.length) * blocks.length)];
      sampled.push(...block);
    }
    samples.push(mean(sampled.slice(0, values.length)) ?? 0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.05)] ?? null;
}

function random(seedA: number, seedB: number): number {
  const x = Math.sin((seedA + 1) * 10000 + (seedB + 1) * 9973) * 10000;
  return x - Math.floor(x);
}

function renderMarkdown(report: any): string {
  const lines = [
    '# BTC Dynamic Volatility Interval Experiment',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Setup',
    '',
    `- Validation: ${report.preRegistration.validationPeriod}`,
    `- Final holdout: ${report.preRegistration.finalHoldoutPeriod}`,
    `- Baseline: ${report.preRegistration.baseline}`,
    `- Model form: ${report.preRegistration.modelForm}`,
    `- Leakage policy: ${report.preRegistration.leakagePolicy}`,
    `- Promotion gate: ${report.preRegistration.promotionGate}`,
    '',
    '## Selected candidate summary',
    '',
  ];
  for (const candidate of report.selectedCandidates as CandidateReport[]) {
    lines.push(`### ${candidate.id}`);
    lines.push('');
    lines.push(`- Verdict: **${candidate.verdict}** — ${candidate.verdictReason}`);
    lines.push(`- Description: ${candidate.description}`);
    lines.push(`- Params: ${JSON.stringify(candidate.params)}`);
    lines.push('- Holdout thinned metrics:');
    for (const horizon of HORIZONS) {
      const metric = candidate.holdoutThinned[String(horizon)];
      lines.push(`  - ${horizon}d: samples=${metric.samples}, nllImprovement=${fmtNum(metric.meanNllImprovement)}, lower95=${fmtNum(metric.bootstrapLower95NllImprovement)}, coverage90=${fmtPct(metric.coverage90)}, baselineCoverage90=${fmtPct(metric.baselineCoverage90)}, width90=${fmtNum(metric.meanInterval90WidthLog)}, baselineWidth90=${fmtNum(metric.baselineInterval90WidthLog)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function printSummary(candidates: CandidateReport[]): void {
  console.log('Dynamic volatility holdout summary:');
  for (const candidate of candidates) {
    const compact = HORIZONS.map(horizon => {
      const metric = candidate.holdoutThinned[String(horizon)];
      return `${horizon}d=${fmtNum(metric.meanNllImprovement)} cov90=${fmtPct(metric.coverage90)}`;
    }).join('  ');
    console.log(`${candidate.id} verdict=${candidate.verdict} ${compact}`);
  }
}

function fmtNum(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

function fmtPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

main();
