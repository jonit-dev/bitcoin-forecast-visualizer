import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import btcHistory from '../src/data/btc-history.json';
import macroHistory from '../src/data/macro-history.json';
import type { OHLCVData } from '../src/lib/api';
import type { ForecastDistribution } from '../src/lib/backtestMetrics';
import { normalQuantile } from '../src/lib/forecastInterval';
import { getBacktestModels } from '../src/lib/backtestModels';
import {
  assertPointInTimeMacroSignal,
  buildMacroSignalSeries,
  buildMacroSignalAtOrigin,
  type FredMacroRow,
  type FredMacroSignal,
} from '../src/lib/fredMacroFeatures';

export type ArmId = 'stress-interval' | 'liquidity-median' | 'shock-interval';
export type Horizon = 14 | 30 | 60 | 90;

interface MacroCache {
  metadata?: {
    source?: string;
    vintage?: string;
    observationStart?: string;
    fetchedAt?: string;
    conservativeLagDays?: number;
    series?: Record<string, string>;
    creditSpreadProxy?: {
      seriesId?: string;
      metric?: string;
      label?: string;
      limitation?: string;
    };
    limitations?: string[];
  };
  rows: FredMacroRow[];
}

export interface EvaluationRecord {
  originIndex: number;
  originDate: string;
  targetDate: string;
  horizonDays: Horizon;
  actualPrice: number;
  actualLogPrice: number;
  powerlaw: ForecastDistribution;
  naive: ForecastDistribution;
  macroSignal: FredMacroSignal | null;
}

interface ScoreSummary {
  samples: number;
  nll: number | null;
  meanAbsLogError: number | null;
  medianAbsLogError: number | null;
  coverage90: number | null;
  q05Pinball: number | null;
  q50Pinball: number | null;
  q95Pinball: number | null;
  medianForwardReturn: number | null;
  upRate: number | null;
}

interface BootstrapSummary {
  blockLength: number;
  iterations: number;
  bootstrapLower95OneSided: number | null;
  bootstrapUpper95OneSided: number | null;
  oneSidedPValue: number | null;
}

interface ForecastIdentitySummary {
  baselineOutput: string | null;
  candidateOutput: string | null;
  differsFromBaseline: boolean;
  comparedSamples: number;
  differingSamples: number;
}

export interface ParameterSelection {
  status: 'selected' | 'insufficient-data';
  parameter: number | null;
  validationSignalSamples: number;
  reason: string | null;
}

export interface ComparisonSummary {
  status: 'scored' | 'insufficient-data';
  reason: string | null;
  parameter: number | null;
  parameterIdentity: ForecastIdentitySummary | null;
  samples: number;
  baseline: ScoreSummary;
  candidate: ScoreSummary | null;
  meanNllImprovement: number | null;
  relativeNllImprovement: number | null;
  bootstrap: BootstrapSummary;
  coverage90Delta: number | null;
  medianAbsLogErrorDelta: number | null;
  signalSamples: number;
  horizonSpaced: {
    samples: number;
    meanNllImprovement: number | null;
    bootstrapLower95OneSided: number | null;
    coverage90Delta: number | null;
    medianAbsLogErrorDelta: number | null;
  };
  holmAdjustedPValue: number | null;
  gate: {
    passed: boolean;
    reasons: string[];
  };
}

interface ArmReport {
  id: ArmId;
  hypothesis: string;
  formula: string;
  parameterGrid: number[];
  threshold: number;
  selectedParameterByHorizon: Record<string, number | null>;
  selectionStatusByHorizon: Record<string, ParameterSelection['status']>;
  validation: Record<string, ComparisonSummary>;
  holdout: Record<string, ComparisonSummary>;
  holdoutHorizonSpaced: Record<string, ComparisonSummary['horizonSpaced']>;
  verdict: 'research-only-positive' | 'context-only' | 'needs-rerun';
  verdictReason: string;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const MACRO_CACHE = macroHistory as MacroCache;
const MACRO_ROWS = [...(MACRO_CACHE.rows ?? [])].sort((left, right) => left.date.localeCompare(right.date));
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const JSON_PATH = join(REPORT_DIR, 'btc-fred-macro-experiments.json');
const MARKDOWN_PATH = join(REPORT_DIR, 'btc-fred-macro-experiments.md');
const VALIDATION_START = '2018-01-01';
const VALIDATION_END = '2022-12-31';
const HOLDOUT_START = '2023-01-01';
const HORIZONS: readonly Horizon[] = [14, 30, 60, 90];
const BOOTSTRAP_ITERATIONS = 2_000;
const MIN_HOLDOUT_SAMPLES = 30;
const STRESS_THRESHOLD = 1;
const SHOCK_THRESHOLD = 1;
const PARAMETER_GRIDS: Record<ArmId, number[]> = {
  'stress-interval': [0, 0.1, 0.2, 0.35, 0.5, 0.75],
  'liquidity-median': [-0.1, -0.05, 0, 0.05, 0.1],
  'shock-interval': [0, 0.1, 0.2, 0.35, 0.5, 0.75],
};
const ARM_SPECS: Record<ArmId, { hypothesis: string; formula: string; threshold: number }> = {
  'stress-interval': {
    hypothesis: 'A point-in-time stress composite widens the current power-law interval when credit, financial conditions, volatility, dollar momentum, or curve inversion is stressed.',
    formula: 'sigma_candidate = sigma_powerlaw * (1 + scale * I(stressComposite >= 1)); median unchanged.',
    threshold: STRESS_THRESHOLD,
  },
  'liquidity-median': {
    hypothesis: 'A point-in-time liquidity composite shifts the log median while leaving the baseline interval scale unchanged.',
    formula: 'log(median_candidate) = log(median_powerlaw) + coefficient * liquidityComposite.',
    threshold: 0,
  },
  'shock-interval': {
    hypothesis: 'A positive 30-day shock in the point-in-time stress composite widens the interval without moving the median.',
    formula: 'sigma_candidate = sigma_powerlaw * (1 + multiplier * I(stressShockZ30d >= 1)); median unchanged.',
    threshold: SHOCK_THRESHOLD,
  },
};
const ARMS: readonly ArmId[] = ['stress-interval', 'liquidity-median', 'shock-interval'];

function main(): void {
  if (process.argv.includes('--self-compare-negative-control')) {
    const baseline: ForecastDistribution = {
      median: 100,
      sigma: 0.2,
      quantiles: { q05: 72, q50: 100, q95: 139 },
    };
    assertCandidateForecastsDiffer(
      baseline,
      buildCandidateForecast(baseline, null, 'stress-interval', 0, 14),
    );
  }

  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  const naive = getBacktestModels().find(model => model.id === 'naive-current-price');
  if (!powerlaw || !naive) throw new Error('Required powerlaw-current or naive-current-price model not found.');
  if (MACRO_ROWS.length === 0) throw new Error('FRED macro cache is empty. Run yarn update:macro before the experiment.');

  const signalSeries = buildMacroSignalSeries(MACRO_ROWS);
  const recordsByHorizon = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon), buildEvaluationRecords(horizon, powerlaw.forecast, naive.forecast, signalSeries),
  ])) as Record<string, EvaluationRecord[]>;
  const selections = Object.fromEntries(ARMS.map(arm => [
    arm,
    Object.fromEntries(HORIZONS.map(horizon => {
      const records = recordsByHorizon[String(horizon)];
      return [String(horizon), selectParameter(arm, horizon, records)];
    })),
  ])) as Record<ArmId, Record<string, ParameterSelection>>;

  const unadjustedTests: Array<{ arm: ArmId; horizon: Horizon; pValue: number | null }> = [];
  const armReports = ARMS.map(arm => {
    const validation = Object.fromEntries(HORIZONS.map(horizon => {
      const records = recordsByHorizon[String(horizon)];
      const selection = selections[arm][String(horizon)];
      return [String(horizon), compareRecords(records, arm, selection.parameter, 'validation', horizon, selection.reason)];
    })) as Record<string, ComparisonSummary>;
    const holdout = Object.fromEntries(HORIZONS.map(horizon => {
      const records = recordsByHorizon[String(horizon)];
      const selection = selections[arm][String(horizon)];
      const comparison = compareRecords(records, arm, selection.parameter, 'holdout', horizon, selection.reason);
      unadjustedTests.push({ arm, horizon, pValue: comparison.bootstrap.oneSidedPValue });
      return [String(horizon), comparison];
    })) as Record<string, ComparisonSummary>;
    const holdoutHorizonSpaced = Object.fromEntries(HORIZONS.map(horizon => [
      String(horizon), holdout[String(horizon)].horizonSpaced,
    ])) as Record<string, ComparisonSummary['horizonSpaced']>;
    return { arm, validation, holdout, holdoutHorizonSpaced };
  });

  applyHolmCorrection(armReports, unadjustedTests);
  const reports: ArmReport[] = armReports.map(({ arm, validation, holdout, holdoutHorizonSpaced }) => {
    const gate = evaluatePromotionGate(holdout);
    const hasInsufficientData = HORIZONS.some(horizon => holdout[String(horizon)].status === 'insufficient-data');
    const selectionByHorizon = selections[arm];
    const verdict = gate.passed
      ? 'research-only-positive'
      : hasInsufficientData
        ? 'needs-rerun'
        : 'context-only';
    return {
      id: arm,
      hypothesis: ARM_SPECS[arm].hypothesis,
      formula: ARM_SPECS[arm].formula,
      parameterGrid: PARAMETER_GRIDS[arm],
      threshold: ARM_SPECS[arm].threshold,
      selectedParameterByHorizon: Object.fromEntries(HORIZONS.map(horizon => [
        String(horizon), selectionByHorizon[String(horizon)].parameter,
      ])),
      selectionStatusByHorizon: Object.fromEntries(HORIZONS.map(horizon => [
        String(horizon), selectionByHorizon[String(horizon)].status,
      ])),
      validation,
      holdout,
      holdoutHorizonSpaced,
      verdict,
      verdictReason: gate.passed
        ? 'The numerical holdout gate passed, but latest-revised FRED observations are not ALFRED vintages, so this remains research-only.'
        : hasInsufficientData
          ? `needs more data: ${gate.reasons.join('; ')}. Rerun after an authenticated BTC-era cache is available.`
          : `The numerical promotion gate failed: ${gate.reasons.join('; ')}. Keep the signal context-only.`,
    };
  });

  const dataAudit = buildDataAudit(signalSeries, recordsByHorizon);
  if (dataAudit.validationTargetLeakageCount !== 0 || dataAudit.holdoutTargetBeforeStartCount !== 0) {
    throw new Error(`target split leakage detected: validation=${dataAudit.validationTargetLeakageCount}, holdout=${dataAudit.holdoutTargetBeforeStartCount}`);
  }

  const report = {
    metadata: {
      generatedAt: new Date().toISOString(),
      command: 'yarn backtest:fred-macro',
      asset: 'BTC',
      artifactPaths: [JSON_PATH, MARKDOWN_PATH],
      horizons: HORIZONS,
      bootstrapIterations: BOOTSTRAP_ITERATIONS,
      bootstrapBlockLength: 'equal to forecast horizon',
      multipleTesting: 'Holm correction across three arms and four horizons',
    },
    preRegistration: {
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest target with a complete horizon`,
      selectionCutoff: HOLDOUT_START,
      holdoutParameterSelectionOrigins: [],
      origins: 'daily for primary scores; horizon-spaced origins for non-overlapping robustness',
      target: 'BTC close at origin + horizonDays; validation targets <= 2022-12-31 and holdout targets >= 2023-01-01',
      primaryMetrics: ['mean log-score/NLL', 'mean absolute log error'],
      secondaryMetrics: ['90% coverage', 'q05/q95 log pinball', 'median absolute log error'],
      promotionThreshold: 'At least 30 final-holdout daily origins, positive one-sided lower 95% block-bootstrap bound after Holm review, no median-error regression, stable 90% coverage, and no horizon-spaced failure.',
      bootstrapBoundDefinition: 'bootstrapLower95OneSided is the 5th percentile of the paired-improvement bootstrap distribution; the gate uses this one-sided lower bound. bootstrapUpper95OneSided is the 95th percentile and is not called a two-sided 95% interval.',
      noAppChange: 'All candidate signals remain outside the production feature table, median, interval, model, and UI paths.',
    },
    dataAudit,
    baselines: buildBaselineReport(recordsByHorizon),
    candidateArms: reports,
    leakageProof: {
      availabilityRule: 'A macro row dated d is eligible at origin o only when row.availableAfter <= o; availableAfter is the latest contributing FRED observation date plus 30 calendar days.',
      rollingStatisticsRule: 'Every z-score at row i uses values from rows with index < i; the current observation is excluded from its own mean and variance.',
      targetRule: 'The target close at origin + horizonDays is read only after the forecast is constructed and is never used for signal construction or parameter selection.',
      parameterRule: 'Each arm and horizon selects its parameter by validation NLL only; holdout scores are computed after selection and cannot alter the parameter.',
      revisedDataLimitation: 'The cache contains latest-revised FRED observations rather than ALFRED vintages. This proof prevents timestamp lookahead but cannot claim vintage safety; all results remain research-only.',
      creditSpreadProxyRule: MACRO_CACHE.metadata?.creditSpreadProxy?.limitation
        ?? 'The cache must identify any historical credit-spread proxy and must not claim equivalence to an ICE/BofA high-yield index.',
    },
    limitations: [
      'Latest-revised FRED observations can incorporate later revisions, so this is not a vintage-safe production experiment.',
      'Static power-law coefficients and interval calibration are inherited from the current app baseline and are not re-fit by this runner.',
      'A positive result would require an ALFRED/vintage-safe rerun before any app-facing change.',
      ...(MACRO_CACHE.metadata?.limitations ?? []),
    ],
    verdict: reports.some(reportItem => reportItem.verdict === 'needs-rerun')
      ? 'needs-rerun'
      : reports.every(reportItem => reportItem.verdict === 'research-only-positive')
        ? 'research-only-positive'
        : 'context-only',
    reportsGeneratedWithoutProductionChange: true,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(MARKDOWN_PATH, renderMarkdown(report));
  console.log(`FRED macro experiment verdict: ${report.verdict}`);
  for (const arm of reports) {
    const summary = HORIZONS.map(horizon => {
      const item = arm.holdout[String(horizon)];
      return `${horizon}d=${format(item.meanNllImprovement)} (pHolm=${format(item.holmAdjustedPValue)})`;
    }).join(' ');
    console.log(`${arm.id}: ${summary} verdict=${arm.verdict}`);
  }
  console.log(`JSON report: ${JSON_PATH}`);
  console.log(`Markdown report: ${MARKDOWN_PATH}`);
}

function buildEvaluationRecords(
  horizonDays: Horizon,
  powerlawForecast: (rows: OHLCVData[], originIndex: number, horizonDays: number) => ForecastDistribution | null,
  naiveForecast: (rows: OHLCVData[], originIndex: number, horizonDays: number) => ForecastDistribution | null,
  signalSeries: Array<FredMacroSignal | null>
): EvaluationRecord[] {
  const records: EvaluationRecord[] = [];
  for (let originIndex = 365; originIndex + horizonDays < BTC_ROWS.length; originIndex++) {
    const origin = BTC_ROWS[originIndex];
    const target = BTC_ROWS[originIndex + horizonDays];
    if (origin.date < VALIDATION_START || !isContiguous(originIndex, horizonDays)) continue;
    const powerlaw = powerlawForecast(BTC_ROWS, originIndex, horizonDays);
    const naive = naiveForecast(BTC_ROWS, originIndex, horizonDays);
    if (!powerlaw || !naive || !Number.isFinite(powerlaw.median) || !Number.isFinite(naive.median)) continue;
    const macroSignal = buildMacroSignalAtOrigin(MACRO_ROWS, origin.date, signalSeries);
    if (macroSignal) assertPointInTimeMacroSignal(macroSignal, origin.date);
    records.push({
      originIndex,
      originDate: origin.date,
      targetDate: target.date,
      horizonDays,
      actualPrice: target.close,
      actualLogPrice: Math.log(target.close),
      powerlaw,
      naive,
      macroSignal,
    });
  }
  return records;
}

type TimedRecord = Pick<EvaluationRecord, 'originDate' | 'targetDate'>;

export function selectPeriodRecords<T extends TimedRecord>(records: T[], period: 'validation' | 'holdout'): T[] {
  return records.filter(record => period === 'validation'
    ? record.originDate >= VALIDATION_START
      && record.originDate <= VALIDATION_END
      && record.targetDate <= VALIDATION_END
    : record.originDate >= HOLDOUT_START
      && record.targetDate >= HOLDOUT_START);
}

export function selectParameter(arm: ArmId, _horizon: Horizon, records: EvaluationRecord[]): ParameterSelection {
  const validationRecords = selectPeriodRecords(records, 'validation');
  const signalRecords = validationRecords.filter(record => hasArmSignal(record.macroSignal, arm));
  if (signalRecords.length === 0) {
    return {
      status: 'insufficient-data',
      parameter: null,
      validationSignalSamples: 0,
      reason: 'no usable validation signal rows; parameter selection is not defined',
    };
  }
  const choices = PARAMETER_GRIDS[arm].map(parameter => {
    const comparison = scoreComparison(signalRecords, arm, parameter, _horizon, false);
    return { parameter, nll: comparison.candidate.nll ?? Number.POSITIVE_INFINITY };
  });
  choices.sort((left, right) => left.nll - right.nll || Math.abs(left.parameter) - Math.abs(right.parameter));
  const best = choices.find(choice => Number.isFinite(choice.nll));
  const parameter = best?.parameter ?? null;
  return {
    status: parameter === null ? 'insufficient-data' : 'selected',
    parameter,
    validationSignalSamples: signalRecords.length,
    reason: parameter === null ? 'validation signal rows had no finite candidate score' : null,
  };
}

export function compareRecords(
  records: EvaluationRecord[],
  arm: ArmId,
  parameter: number | null,
  period: 'validation' | 'holdout',
  horizon: Horizon,
  insufficientDataReason: string | null = null,
): ComparisonSummary {
  const selected = selectPeriodRecords(records, period);
  if (parameter === null) return createInsufficientComparison(selected, arm, horizon, insufficientDataReason);
  const comparison = scoreComparison(selected, arm, parameter, horizon, true);
  const horizonSpacedRecords = selected.filter((_, index) => index % horizon === 0);
  const horizonSpaced = scoreComparison(horizonSpacedRecords, arm, parameter, horizon, false);
  const horizonSpacedImprovements = pairedNllImprovements(horizonSpacedRecords, arm, parameter, horizon);
  const improvements = pairedNllImprovements(selected, arm, parameter, horizon);
  const bootstrap = period === 'holdout'
    ? movingBlockBootstrap(improvements, horizon, BOOTSTRAP_ITERATIONS, seedFor(arm, horizon))
    : emptyBootstrap(horizon);
  const horizonSpacedBootstrap = period === 'holdout'
    ? movingBlockBootstrap(horizonSpacedImprovements, horizon, BOOTSTRAP_ITERATIONS, seedFor(arm, horizon) + 17)
    : emptyBootstrap(horizon);
  const identity = buildForecastIdentity(selected, arm, parameter, horizon);
  return {
    status: 'scored',
    reason: null,
    parameter,
    parameterIdentity: identity,
    samples: comparison.candidate.samples,
    baseline: comparison.baseline,
    candidate: comparison.candidate,
    meanNllImprovement: mean(improvements),
    relativeNllImprovement: relativeImprovement(comparison.baseline.nll, comparison.candidate.nll),
    bootstrap,
    coverage90Delta: differenceNullable(comparison.candidate.coverage90, comparison.baseline.coverage90),
    medianAbsLogErrorDelta: differenceNullable(comparison.baseline.medianAbsLogError, comparison.candidate.medianAbsLogError),
    signalSamples: selected.filter(record => hasArmSignal(record.macroSignal, arm)).length,
    horizonSpaced: {
      samples: horizonSpaced.candidate.samples,
      meanNllImprovement: mean(horizonSpacedImprovements),
      bootstrapLower95OneSided: horizonSpacedBootstrap.bootstrapLower95OneSided,
      coverage90Delta: differenceNullable(horizonSpaced.candidate.coverage90, horizonSpaced.baseline.coverage90),
      medianAbsLogErrorDelta: differenceNullable(horizonSpaced.baseline.medianAbsLogError, horizonSpaced.candidate.medianAbsLogError),
    },
    holmAdjustedPValue: null,
    gate: { passed: false, reasons: [] },
  };
}

function createInsufficientComparison(
  records: EvaluationRecord[],
  arm: ArmId,
  horizon: Horizon,
  reason: string | null,
): ComparisonSummary {
  return {
    status: 'insufficient-data',
    reason: reason ?? 'insufficient data for candidate scoring',
    parameter: null,
    parameterIdentity: null,
    samples: 0,
    baseline: scoreForecasts(records, records.map(record => record.powerlaw), true),
    candidate: null,
    meanNllImprovement: null,
    relativeNllImprovement: null,
    bootstrap: emptyBootstrap(horizon),
    coverage90Delta: null,
    medianAbsLogErrorDelta: null,
    signalSamples: records.filter(record => hasArmSignal(record.macroSignal, arm)).length,
    horizonSpaced: {
      samples: 0,
      meanNllImprovement: null,
      bootstrapLower95OneSided: null,
      coverage90Delta: null,
      medianAbsLogErrorDelta: null,
    },
    holmAdjustedPValue: null,
    gate: { passed: false, reasons: [] },
  };
}

function buildForecastIdentity(
  records: EvaluationRecord[],
  arm: ArmId,
  parameter: number,
  horizon: Horizon,
): ForecastIdentitySummary {
  const differing = records.filter(record => forecastOutputsDiffer(
    record.powerlaw,
    buildCandidateForecast(record.powerlaw, record.macroSignal, arm, parameter, horizon),
  ));
  const first = records[0];
  return {
    baselineOutput: first ? serializeForecast(first.powerlaw) : null,
    candidateOutput: first
      ? serializeForecast(buildCandidateForecast(first.powerlaw, first.macroSignal, arm, parameter, horizon))
      : null,
    differsFromBaseline: differing.length > 0,
    comparedSamples: records.length,
    differingSamples: differing.length,
  };
}

function scoreComparison(
  records: EvaluationRecord[],
  arm: ArmId,
  parameter: number,
  horizon: Horizon,
  includeBaseline: boolean
): { baseline: ScoreSummary; candidate: ScoreSummary } {
  const baselineForecasts = records.map(record => record.powerlaw);
  const candidateForecasts = records.map(record => buildCandidateForecast(record.powerlaw, record.macroSignal, arm, parameter, horizon));
  return {
    baseline: scoreForecasts(records, baselineForecasts, includeBaseline),
    candidate: scoreForecasts(records, candidateForecasts, true),
  };
}

function scoreForecasts(records: EvaluationRecord[], forecasts: ForecastDistribution[], includeNll: boolean): ScoreSummary {
  const absErrors: number[] = [];
  const nlls: number[] = [];
  const q05Losses: number[] = [];
  const q50Losses: number[] = [];
  const q95Losses: number[] = [];
  const covered90: boolean[] = [];
  const forwardReturns: number[] = [];
  let upCount = 0;
  records.forEach((record, index) => {
    const forecast = forecasts[index];
    const actualLog = record.actualLogPrice;
    const medianLog = Math.log(forecast.median);
    const absLogError = Math.abs(actualLog - medianLog);
    if (Number.isFinite(absLogError)) absErrors.push(absLogError);
    const q50Loss = pinballLoss(actualLog, medianLog, 0.5);
    if (Number.isFinite(q50Loss)) q50Losses.push(q50Loss);
    if (includeNll && Number.isFinite(forecast.sigma) && (forecast.sigma ?? 0) > 0) {
      const sigma = forecast.sigma as number;
      const nll = normalNll(actualLog, medianLog, sigma);
      if (Number.isFinite(nll)) nlls.push(nll);
    }
    const q05 = logQuantile(forecast, 'q05');
    const q95 = logQuantile(forecast, 'q95');
    if (q05 !== null) q05Losses.push(pinballLoss(actualLog, q05, 0.05));
    if (q95 !== null) q95Losses.push(pinballLoss(actualLog, q95, 0.95));
    if (q05 !== null && q95 !== null) covered90.push(actualLog >= q05 && actualLog <= q95);
    if (record.actualPrice > 0 && forecast.median > 0) forwardReturns.push(Math.log(record.actualPrice / forecast.median));
    if (record.actualPrice > record.powerlaw.median) upCount++;
  });
  return {
    samples: records.length,
    nll: mean(nlls),
    meanAbsLogError: mean(absErrors),
    medianAbsLogError: median(absErrors),
    coverage90: covered90.length > 0 ? covered90.filter(Boolean).length / covered90.length : null,
    q05Pinball: mean(q05Losses),
    q50Pinball: mean(q50Losses),
    q95Pinball: mean(q95Losses),
    medianForwardReturn: median(forwardReturns),
    upRate: records.length > 0 ? upCount / records.length : null,
  };
}

export function buildCandidateForecast(
  baseline: ForecastDistribution,
  signal: FredMacroSignal | null,
  arm: ArmId,
  parameter: number,
  horizon: Horizon
): ForecastDistribution {
  const stressActive = signal?.stressComposite !== null && signal?.stressComposite !== undefined
    && signal.stressComposite >= STRESS_THRESHOLD;
  const shockActive = signal?.stressShockZ30d !== null && signal?.stressShockZ30d !== undefined
    && signal.stressShockZ30d >= SHOCK_THRESHOLD;
  const liquidity = signal?.liquidityComposite;
  let medianShift = 0;
  let sigmaMultiplier = 1;
  if (arm === 'stress-interval' && stressActive) sigmaMultiplier = 1 + parameter;
  if (arm === 'shock-interval' && shockActive) sigmaMultiplier = 1 + parameter;
  if (arm === 'liquidity-median' && Number.isFinite(liquidity)) medianShift = parameter * (liquidity as number);
  if (medianShift === 0 && sigmaMultiplier === 1) return baseline;
  const median = baseline.median * Math.exp(medianShift);
  const sigma = Number.isFinite(baseline.sigma) && (baseline.sigma ?? 0) > 0
    ? (baseline.sigma as number) * sigmaMultiplier
    : baseline.sigma;
  return withQuantiles(median, sigma, horizon);
}

const FORECAST_OUTPUT_KEYS = ['median', 'sigma', 'q025', 'q05', 'q10', 'q50', 'q90', 'q95', 'q975'] as const;

export function forecastOutputsDiffer(left: ForecastDistribution, right: ForecastDistribution): boolean {
  return FORECAST_OUTPUT_KEYS.some(key => {
    const leftValue = key === 'median' || key === 'sigma' ? left[key] : left.quantiles?.[key];
    const rightValue = key === 'median' || key === 'sigma' ? right[key] : right.quantiles?.[key];
    const leftFinite = typeof leftValue === 'number' && Number.isFinite(leftValue);
    const rightFinite = typeof rightValue === 'number' && Number.isFinite(rightValue);
    if (leftFinite !== rightFinite) return true;
    if (!leftFinite && !rightFinite) return false;
    const scale = Math.max(1, Math.abs(leftValue as number), Math.abs(rightValue as number));
    return Math.abs((leftValue as number) - (rightValue as number)) > 1e-12 * scale;
  });
}

function serializeForecast(forecast: ForecastDistribution): string {
  return JSON.stringify(FORECAST_OUTPUT_KEYS.map(key => {
    const value = key === 'median' || key === 'sigma' ? forecast[key] : forecast.quantiles?.[key];
    return [key, typeof value === 'number' && Number.isFinite(value) ? value : null];
  }));
}

export function assertCandidateForecastsDiffer(
  baseline: ForecastDistribution,
  candidate: ForecastDistribution,
): void {
  if (!forecastOutputsDiffer(baseline, candidate)) {
    throw new Error('candidate and baseline identities were equal');
  }
}

function pairedNllImprovements(records: EvaluationRecord[], arm: ArmId, parameter: number, horizon: Horizon): number[] {
  return records.map(record => {
    const baseline = record.powerlaw;
    const candidate = buildCandidateForecast(baseline, record.macroSignal, arm, parameter, horizon);
    if (!Number.isFinite(baseline.sigma) || (baseline.sigma ?? 0) <= 0 || !Number.isFinite(candidate.sigma) || (candidate.sigma ?? 0) <= 0) return null;
    return normalNll(record.actualLogPrice, Math.log(baseline.median), baseline.sigma as number)
      - normalNll(record.actualLogPrice, Math.log(candidate.median), candidate.sigma as number);
  }).filter((value): value is number => Number.isFinite(value));
}

function hasArmSignal(signal: FredMacroSignal | null, arm: ArmId): boolean {
  if (!signal) return false;
  if (arm === 'liquidity-median') return Number.isFinite(signal.liquidityComposite);
  if (arm === 'stress-interval') return Number.isFinite(signal.stressComposite);
  return Number.isFinite(signal.stressShockZ30d);
}

export function evaluatePromotionGate(holdout: Record<string, ComparisonSummary>): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const horizon of HORIZONS) {
    const item = holdout[String(horizon)];
    if (item.status !== 'scored' || item.candidate === null) {
      reasons.push(`${horizon}d needs more data: ${item.reason ?? 'candidate was not scored'}`);
      continue;
    }
    if (item.samples < MIN_HOLDOUT_SAMPLES) reasons.push(`${horizon}d holdout samples ${item.samples} < ${MIN_HOLDOUT_SAMPLES}`);
    if (!(item.meanNllImprovement !== null && item.meanNllImprovement > 0)) reasons.push(`${horizon}d mean NLL improvement is not positive`);
    if (!(item.bootstrap.bootstrapLower95OneSided !== null && item.bootstrap.bootstrapLower95OneSided > 0)) reasons.push(`${horizon}d daily block-bootstrap one-sided lower95 is not positive`);
    if (!(item.holmAdjustedPValue !== null && item.holmAdjustedPValue < 0.05)) reasons.push(`${horizon}d Holm-adjusted p-value is not below 0.05`);
    if (!(item.medianAbsLogErrorDelta !== null && item.medianAbsLogErrorDelta >= 0)) reasons.push(`${horizon}d median absolute log error regressed`);
    if (!(item.coverage90Delta !== null && item.coverage90Delta >= -0.02 && item.coverage90Delta <= 0.05)) reasons.push(`${horizon}d 90% coverage delta is outside [-0.02, 0.05]`);
    if (item.horizonSpaced.samples === 0) reasons.push(`${horizon}d horizon-spaced sample count is zero`);
    if (!(item.horizonSpaced.bootstrapLower95OneSided !== null && item.horizonSpaced.bootstrapLower95OneSided > 0)) reasons.push(`${horizon}d horizon-spaced robustness failed`);
    if (!item.parameterIdentity?.differsFromBaseline) reasons.push(`${horizon}d candidate forecast outputs are identical to baseline`);
  }
  return { passed: reasons.length === 0, reasons };
}

function applyHolmCorrection(
  armReports: Array<{ arm: ArmId; holdout: Record<string, ComparisonSummary> }>,
  tests: Array<{ arm: ArmId; horizon: Horizon; pValue: number | null }>
): void {
  const valid = tests
    .filter(test => test.pValue !== null)
    .map(test => ({ ...test, pValue: test.pValue as number }))
    .sort((left, right) => left.pValue - right.pValue);
  let runningMaximum = 0;
  valid.forEach((test, rank) => {
    runningMaximum = Math.max(runningMaximum, Math.min(1, (valid.length - rank) * test.pValue));
    const report = armReports.find(item => item.arm === test.arm);
    if (report) report.holdout[String(test.horizon)].holmAdjustedPValue = runningMaximum;
  });
  tests.filter(test => test.pValue === null).forEach(test => {
    const report = armReports.find(item => item.arm === test.arm);
    if (report) report.holdout[String(test.horizon)].holmAdjustedPValue = null;
  });
}

function buildDataAudit(signalSeries: Array<FredMacroSignal | null>, recordsByHorizon: Record<string, EvaluationRecord[]>) {
  const allRecords = Object.values(recordsByHorizon).flat();
  const usedSignals = allRecords.map(record => record.macroSignal).filter(Boolean) as FredMacroSignal[];
  const validationRecords = allRecords.filter(record => record.originDate >= VALIDATION_START && record.originDate <= VALIDATION_END);
  const validationSplitRecords = selectPeriodRecords(allRecords, 'validation');
  const holdoutSplitRecords = selectPeriodRecords(allRecords, 'holdout');
  const years = ['2018', '2020', '2022'].map(year => ({
    year,
    rows: MACRO_ROWS.filter(row => row.date.startsWith(year)).length,
  }));
  return {
    source: MACRO_CACHE.metadata?.source ?? 'unknown',
    vintage: MACRO_CACHE.metadata?.vintage ?? 'unspecified',
    fetchedAt: MACRO_CACHE.metadata?.fetchedAt ?? null,
    observationStart: MACRO_CACHE.metadata?.observationStart ?? null,
    series: MACRO_CACHE.metadata?.series ?? {},
    creditSpreadProxy: MACRO_CACHE.metadata?.creditSpreadProxy ?? null,
    sourceLimitations: MACRO_CACHE.metadata?.limitations ?? [],
    conservativeLagDays: MACRO_CACHE.metadata?.conservativeLagDays ?? 30,
    macroRows: MACRO_ROWS.length,
    macroFirstDate: MACRO_ROWS[0]?.date ?? null,
    macroLastDate: MACRO_ROWS.at(-1)?.date ?? null,
    regimeYearCoverage: years,
    signalRows: signalSeries.filter(Boolean).length,
    usedSignalRows: new Set(usedSignals.map(signal => signal.rowDate)).size,
    validationOrigins: validationSplitRecords.length,
    holdoutOrigins: holdoutSplitRecords.length,
    validationTargetLeakageCount: validationSplitRecords.filter(record => record.targetDate > VALIDATION_END).length,
    validationOriginWindowExcludedTargetCount: validationRecords.filter(record => record.targetDate > VALIDATION_END).length,
    holdoutTargetBeforeStartCount: holdoutSplitRecords.filter(record => record.targetDate < HOLDOUT_START).length,
    pointInTimeViolations: 0,
    revisedDataResearchOnly: true,
  };
}

function buildBaselineReport(recordsByHorizon: Record<string, EvaluationRecord[]>) {
  return Object.fromEntries(HORIZONS.map(horizon => {
    const records = recordsByHorizon[String(horizon)];
    const powerlawCurrent = scoreForecasts(records, records.map(record => record.powerlaw), true);
    const naiveCurrentPrice = scoreForecasts(records, records.map(record => record.naive), false);
    return [String(horizon), {
      powerlawCurrent,
      naiveCurrentPrice,
      naiveComparison: {
        medianAbsLogErrorDelta: differenceNullable(naiveCurrentPrice.medianAbsLogError, powerlawCurrent.medianAbsLogError),
        q50PinballDelta: differenceNullable(naiveCurrentPrice.q50Pinball, powerlawCurrent.q50Pinball),
      },
      naiveMetricApplicability: {
        applicable: ['meanAbsLogError', 'medianAbsLogError', 'q50Pinball', 'medianForwardReturn', 'upRate'],
        notApplicable: ['nll', 'coverage90', 'q05Pinball', 'q95Pinball'],
        reason: 'naive-current-price is a median-only forecast and has no finite interval or sigma; NLL, interval coverage, and tail pinball are not applicable.',
      },
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      holdoutPeriod: `${HOLDOUT_START} through latest target`,
    }];
  }));
}

function withQuantiles(median: number, sigma: number | null | undefined, _horizon: Horizon): ForecastDistribution {
  if (!Number.isFinite(sigma) || (sigma ?? 0) <= 0) return { median, sigma };
  const safeSigma = sigma as number;
  return {
    median,
    sigma: safeSigma,
    quantiles: {
      q025: median * Math.exp(safeSigma * normalQuantile(0.025)),
      q05: median * Math.exp(safeSigma * normalQuantile(0.05)),
      q10: median * Math.exp(safeSigma * normalQuantile(0.10)),
      q50: median,
      q90: median * Math.exp(safeSigma * normalQuantile(0.90)),
      q95: median * Math.exp(safeSigma * normalQuantile(0.95)),
      q975: median * Math.exp(safeSigma * normalQuantile(0.975)),
    },
  };
}

function logQuantile(forecast: ForecastDistribution, key: 'q05' | 'q95'): number | null {
  const value = forecast.quantiles?.[key];
  return Number.isFinite(value) && (value as number) > 0 ? Math.log(value as number) : null;
}

function normalNll(actualLog: number, medianLog: number, sigma: number): number | null {
  if (!Number.isFinite(actualLog) || !Number.isFinite(medianLog) || !Number.isFinite(sigma) || sigma <= 0) return null;
  return 0.5 * Math.log(2 * Math.PI * sigma * sigma) + (actualLog - medianLog) ** 2 / (2 * sigma * sigma);
}

function pinballLoss(actual: number, predicted: number, quantile: number): number {
  const error = actual - predicted;
  return Math.max(quantile * error, (quantile - 1) * error);
}

function movingBlockBootstrap(values: number[], blockLength: number, iterations: number, seed: number): BootstrapSummary {
  if (values.length === 0) return emptyBootstrap(blockLength, iterations);
  const random = mulberry32(seed);
  const means: number[] = [];
  const observed = mean(values) as number;
  let nullExceedances = 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    let total = 0;
    let nullTotal = 0;
    let count = 0;
    while (count < values.length) {
      const start = Math.floor(random() * Math.max(1, values.length - blockLength + 1));
      for (let offset = 0; offset < blockLength && count < values.length; offset++, count++) {
        total += values[start + offset];
        nullTotal += values[start + offset] - observed;
      }
    }
    const sampledMean = total / values.length;
    means.push(sampledMean);
    if (nullTotal / values.length >= observed) nullExceedances++;
  }
  means.sort((left, right) => left - right);
  return {
    blockLength,
    iterations,
    bootstrapLower95OneSided: quantileSorted(means, 0.05),
    bootstrapUpper95OneSided: quantileSorted(means, 0.95),
    oneSidedPValue: (nullExceedances + 1) / (iterations + 1),
  };
}

function emptyBootstrap(blockLength: number, iterations = BOOTSTRAP_ITERATIONS): BootstrapSummary {
  return {
    blockLength,
    iterations,
    bootstrapLower95OneSided: null,
    bootstrapUpper95OneSided: null,
    oneSidedPValue: null,
  };
}

function quantileSorted(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(probability * values.length)));
  return values[index];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function seedFor(arm: ArmId, horizon: Horizon): number {
  const armSeed = ARMS.indexOf(arm) + 1;
  return 0xFEE000 + armSeed * 997 + horizon * 131;
}

function isContiguous(originIndex: number, horizon: number): boolean {
  for (let index = 0; index < horizon; index++) {
    const current = Date.parse(`${BTC_ROWS[originIndex + index].date}T00:00:00Z`);
    const next = Date.parse(`${BTC_ROWS[originIndex + index + 1].date}T00:00:00Z`);
    if ((next - current) / 86400000 !== 1) return false;
  }
  return true;
}

function differenceNullable(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function relativeImprovement(baseline: number | null, candidate: number | null): number | null {
  return baseline === null || candidate === null || baseline === 0 ? null : (baseline - candidate) / Math.abs(baseline);
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function format(value: number | null | undefined): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(6);
}

function renderMarkdown(report: any): string {
  const lines = [
    '# BTC FRED Macro Forecast Experiments',
    '',
    `Status: \`${report.verdict}\`; no production forecast, feature-table, interval, median, or UI behavior changed.`,
    '',
    '## Pre-registration',
    '',
    `- Validation: ${report.preRegistration.validationPeriod}.`,
    `- Untouched final holdout: ${report.preRegistration.finalHoldoutPeriod}.`,
    `- Parameter selection cutoff: ${report.preRegistration.selectionCutoff}; holdout selections recorded: ${report.preRegistration.holdoutParameterSelectionOrigins.length}.`,
    `- Horizons: ${report.metadata.horizons.join(', ')} days; primary metrics: ${report.preRegistration.primaryMetrics.join(', ')}.`,
    `- Bootstrap: ${report.metadata.bootstrapIterations} deterministic moving-block resamples, block length ${report.metadata.bootstrapBlockLength}; ${report.metadata.multipleTesting}. The gate uses the one-sided lower bound named \`bootstrapLower95OneSided\`, not a two-sided interval.`,
    '',
    '## Data audit',
    '',
    `- Source: ${report.dataAudit.source}; vintage: ${report.dataAudit.vintage}; fetched: ${report.dataAudit.fetchedAt ?? 'not recorded'}.`,
    `- Macro cache: ${report.dataAudit.macroRows} rows, ${report.dataAudit.macroFirstDate ?? 'n/a'} → ${report.dataAudit.macroLastDate ?? 'n/a'}; signal rows: ${report.dataAudit.signalRows}.`,
    `- Required regime years: ${report.dataAudit.regimeYearCoverage.map((item: any) => `${item.year}=${item.rows}`).join(', ')}.`,
    `- Credit-spread source: ${report.dataAudit.creditSpreadProxy?.seriesId ?? 'not recorded'} (${report.dataAudit.creditSpreadProxy?.label ?? 'not recorded'}); limitation: ${report.dataAudit.creditSpreadProxy?.limitation ?? 'not recorded'}`,
    `- Target split: validation target leakage=${report.dataAudit.validationTargetLeakageCount}; late-2022 origins excluded because their targets cross the cutoff=${report.dataAudit.validationOriginWindowExcludedTargetCount}; holdout targets before cutoff=${report.dataAudit.holdoutTargetBeforeStartCount}.`,
    `- Revised FRED data research-only: ${report.dataAudit.revisedDataResearchOnly ? 'yes' : 'no'}.`,
    '',
    '## Baselines',
    '',
    '| Horizon | Period | Power-law MALE | Naive MALE | Power-law NLL | Naive q50 | Power-law q50 |',
    '|---:|---|---:|---:|---:|---:|---:|',
  ];
  for (const horizon of report.metadata.horizons) {
    const item = report.baselines[String(horizon)];
    lines.push(`| ${horizon}d | Validation+holdout origins | ${format(item.powerlawCurrent.meanAbsLogError)} | ${format(item.naiveCurrentPrice.meanAbsLogError)} | ${format(item.powerlawCurrent.nll)} | ${format(item.naiveCurrentPrice.q50Pinball)} | ${format(item.powerlawCurrent.q50Pinball)} |`);
  }
  lines.push('', '- Naive benchmark comparison: median absolute log error and q50 pinball are applicable; NLL, 90% interval coverage, q05 pinball, and q95 pinball are not applicable because `naive-current-price` is median-only.', '', '## Candidate arms', '', '| Arm | Horizon | Parameter | Holdout NLL improvement | One-sided lower95 | Holm p | Coverage Δ | MALE Δ | Horizon-spaced one-sided lower95 | Verdict |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const arm of report.candidateArms) {
    for (const horizon of report.metadata.horizons) {
      const item = arm.holdout[String(horizon)];
      lines.push(`| ${arm.id} | ${horizon}d | ${format(item.parameter)} | ${format(item.meanNllImprovement)} | ${format(item.bootstrap.bootstrapLower95OneSided)} | ${format(item.holmAdjustedPValue)} | ${format(item.coverage90Delta)} | ${format(item.medianAbsLogErrorDelta)} | ${format(item.horizonSpaced.bootstrapLower95OneSided)} | ${arm.verdict} |`);
    }
  }
  lines.push('', '## Validation-selected parameters', '', '| Arm | 14d | 30d | 60d | 90d |', '|---|---:|---:|---:|---:|');
  for (const arm of report.candidateArms) {
    lines.push(`| ${arm.id} | ${format(arm.selectedParameterByHorizon['14'])} | ${format(arm.selectedParameterByHorizon['30'])} | ${format(arm.selectedParameterByHorizon['60'])} | ${format(arm.selectedParameterByHorizon['90'])} |`);
  }
  lines.push(
    '',
    '## Mathematical leakage proof',
    '',
    `- Availability: ${report.leakageProof.availabilityRule}`,
    `- Rolling statistics: ${report.leakageProof.rollingStatisticsRule}`,
    `- Target isolation: ${report.leakageProof.targetRule}`,
    `- Selection isolation: ${report.leakageProof.parameterRule}`,
    `- Vintage limitation: ${report.leakageProof.revisedDataLimitation}`,
    `- Credit proxy limitation: ${report.leakageProof.creditSpreadProxyRule}`,
    '',
    '## Arm verdicts and rerun policy',
    '',
  );
  for (const arm of report.candidateArms) {
    lines.push(`### ${arm.id}`, '', `Hypothesis: ${arm.hypothesis}`, '', `Formula: \`${arm.formula}\``, '', `Verdict: \`${arm.verdict}\` — ${arm.verdictReason}`, '', '- Rerun only after an ALFRED/vintage-safe cache, a pre-registered split, and the same untouched-holdout gate.', '- Next better experiment: rerun this arm with historical vintages and a publication-date field, then validate on a newly accumulated holdout.', '');
  }
  lines.push(
    '## Reproducibility',
    '',
    '- Refresh data: `yarn update:macro`.',
    '- Run targeted tests: `yarn test src/lib/__tests__/fredMacroFeatures.test.ts`.',
    '- Run experiment: `yarn backtest:fred-macro`.',
    `- Artifacts: \`${JSON_PATH}\`, \`${MARKDOWN_PATH}\`.`,
    '',
    '## Regression decision',
    '',
    '- Production model and feature-table consumers are unchanged.',
    '- Latest-revised FRED observations are explicitly research-only; no vintage leakage claim is made.',
  );
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
