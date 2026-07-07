import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { aggregateForecastMetrics, type BacktestMetricRow, type MetricInput } from '../src/lib/backtestMetrics';
import { getBacktestModels, type BacktestModelId } from '../src/lib/backtestModels';
import { BACKTEST_CONFIG, CYCLE_EXPERIMENT_CONFIG, ENSEMBLE_CONFIG, INTERVAL_CONFIG, POWER_LAW_CONFIG, RESIDUAL_BOOTSTRAP_CONFIG, TAIL_RISK_CONFIG } from '../src/lib/modelConfig';
import type { PowerLawFitCoefficients } from '../src/lib/powerLawFit';
import { classifyRegime, type RegimeState } from '../src/lib/regimeModel';
import { computeTailRisk } from '../src/lib/tailRisk';
import { normalQuantile } from '../src/lib/forecastInterval';

interface BacktestReport {
  metadata: {
    generatedAt: string;
    command: string;
    gitCommit: string;
    dataset: {
      firstDate: string;
      lastDate: string;
      rowCount: number;
    };
    holdoutStartDate: string;
    rollingOriginSpacingDays: number;
    skippedWindowCount: number;
    modelConfig: {
      powerLaw: typeof POWER_LAW_CONFIG;
      interval: typeof INTERVAL_CONFIG;
      backtest: typeof BACKTEST_CONFIG;
    };
    featureTable?: {
      rowCount: number;
      firstDate: string;
      lastDate: string;
      latestFeatureCount: number;
    };
  };
  horizons: number[];
  models: {
    id: BacktestModelId;
    description: string;
    config: Record<string, unknown>;
  }[];
  metrics: Record<string, Record<BacktestModelId, BacktestMetricRow>>;
  qualityGate: {
    status: 'PASS' | 'FAIL';
    checks: {
      horizonDays: number;
      powerlawMedianAbsLogError: number | null;
      naiveMedianAbsLogError: number | null;
      passed: boolean;
      reason: string;
    }[];
  };
  robustness: {
    status: 'PASS' | 'FAIL';
    blockBootstrapIterations: number;
    checks: RobustnessCheck[];
  };
  regimeSummary?: Record<string, Partial<Record<RegimeState, BacktestMetricRow>>>;
  ablation: {
    modes: {
      id: string;
      enabled: boolean;
      status: 'baseline' | 'disabled' | 'context-only';
      reason: string;
      metrics?: Record<string, BacktestMetricRow>;
    }[];
    enablementGate: {
      defaultEnsembleEnabled: boolean;
      reason: string;
    };
  };
  candidateComparison?: {
    candidateModelId: 'powerlaw-refit-candidate';
    source: string;
    status: 'disabled' | 'watch' | 'eligible-for-manual-config-update';
    reasons: string[];
    checks: {
      horizonDays: number;
      currentMedianAbsLogError: number | null;
      candidateMedianAbsLogError: number | null;
      currentBiasLogError: number | null;
      candidateBiasLogError: number | null;
      coverage: {
        current80: number | null;
        candidate80: number | null;
        current90: number | null;
        candidate90: number | null;
        current95: number | null;
        candidate95: number | null;
      };
      intervalWidthRatio: {
        current80: number | null;
        candidate80: number | null;
        current90: number | null;
        candidate90: number | null;
        current95: number | null;
        candidate95: number | null;
      };
      passed: boolean;
      reason: string;
    }[];
  };
  cycleComparison?: {
    baselineModelId: 'powerlaw-cycle-deterministic-pivots';
    selectedModelId: BacktestModelId;
    status: 'retain-deterministic' | 'selected-default' | 'eligible-for-manual-review';
    reason: string;
    checks: {
      modelId: BacktestModelId;
      horizonDays: number;
      currentMedianAbsLogError: number | null;
      candidateMedianAbsLogError: number | null;
      currentCoverage80: number | null;
      candidateCoverage80: number | null;
      currentCoverage90: number | null;
      candidateCoverage90: number | null;
      currentCoverage95: number | null;
      candidateCoverage95: number | null;
      passed: boolean;
      reason: string;
    }[];
  };
  residualBootstrapComparison?: {
    baselineModelId: 'powerlaw-residual-recent-730d';
    selectedModelId: BacktestModelId;
    status: 'retain-recent' | 'eligible-for-manual-review';
    reason: string;
    highVolatilityCutoff: number;
    checks: {
      modelId: BacktestModelId;
      horizonDays: number;
      overallCoverage95: number | null;
      highVolCoverage95: number | null;
      normalIntervalWidth95: number | null;
      passed: boolean;
      reason: string;
    }[];
  };
  ensembleComparison?: {
    members: string[];
    validationWindow: { start: string; end: string };
    weightsByHorizon: Record<string, Record<string, number>>;
    status: 'disabled' | 'watch' | 'eligible-for-manual-review';
    reason: string;
    checks: {
      horizonDays: number;
      bestSingleModelId: string | null;
      bestSingleMedianAbsLogError: number | null;
      ensembleMedianAbsLogError: number | null;
      bestSingleCoverage80: number | null;
      ensembleCoverage80: number | null;
      passed: boolean;
      reason: string;
    }[];
  };
  tailRiskComparison?: {
    status: 'context-only' | 'watch' | 'eligible-for-manual-review';
    reason: string;
    minimumFlaggedSamples: number;
    checks: {
      multiplier: number;
      horizonDays: number;
      flaggedSamples: number;
      normalSamples: number;
      baseFlaggedCoverage95: number | null;
      adjustedFlaggedCoverage95: number | null;
      adjustedNormalCoverage95: number | null;
      adjustedNormalWidth95: number | null;
      passed: boolean;
      reason: string;
    }[];
  };
}

interface RobustnessCheck {
  horizonDays: number;
  benchmarkModelId: BacktestModelId;
  samples: number;
  blockLength: number;
  medianAbsLogErrorImprovement: number | null;
  meanAbsLogErrorImprovement: number | null;
  bootstrapLower95MeanImprovement: number | null;
  passed: boolean;
  reason: string;
}

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const ROBUSTNESS_BOOTSTRAP_ITERATIONS = 400;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function main(): void {
  const ohlcv = btcHistory as OHLCVData[];
  const args = process.argv.slice(2);
  const candidateSource = parseCandidateArg(args);
  const candidate = candidateSource ? loadCandidateConfig(candidateSource) : null;
  const tauSuite = args.includes('--tau-suite');
  const cycleSuite = args.includes('--cycle-suite');
  const residualBootstrapSuite = args.includes('--residual-bootstrap-suite');
  const ensembleSuite = args.includes('--ensemble-suite') || ENSEMBLE_CONFIG.defaultEnabled;
  const tailRiskSuite = args.includes('--tail-risk-suite') || TAIL_RISK_CONFIG.defaultEnabled;
  const ensembleWeights = ensembleSuite ? learnEnsembleWeights(ohlcv) : undefined;
  const models = getBacktestModels({ powerLawCandidate: candidate?.coefficients, tauSuite, cycleSuite, residualBootstrapSuite, ensembleWeights });
  const metricInputs = new Map<string, Map<BacktestModelId, MetricInput[]>>();
  const featureRows = loadFeatureRowsByDate();
  const regimeInputs = new Map<string, Map<RegimeState, MetricInput[]>>();
  let skippedWindowCount = 0;

  for (const horizon of BACKTEST_CONFIG.horizons) {
    const byModel = new Map<BacktestModelId, MetricInput[]>();
    for (const model of models) byModel.set(model.id, []);
    metricInputs.set(String(horizon), byModel);
    regimeInputs.set(String(horizon), new Map());

    for (
      let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
      originIndex + horizon < ohlcv.length;
      originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
    ) {
      const origin = ohlcv[originIndex];
      if (origin.date < BACKTEST_CONFIG.holdoutStartDate) continue;
      if (!isContiguous(ohlcv, originIndex, horizon)) {
        skippedWindowCount++;
        continue;
      }

      const target = ohlcv[originIndex + horizon];
      for (const model of models) {
        const forecast = model.forecast(ohlcv, originIndex, horizon);
        if (!forecast || !Number.isFinite(forecast.median) || forecast.median <= 0) continue;
        const input = { actual: target.close, forecast };
        byModel.get(model.id)?.push(input);
        if (model.id === 'powerlaw-current' && featureRows.size > 0) {
          const state = classifyRegime(featureRows.get(origin.date)).topState;
          const byState = regimeInputs.get(String(horizon))!;
          if (!byState.has(state)) byState.set(state, []);
          byState.get(state)!.push(input);
        }
      }
    }
  }

  const metrics = Object.fromEntries(
    BACKTEST_CONFIG.horizons.map(horizon => [
      String(horizon),
      Object.fromEntries(
        models.map(model => [
          model.id,
          aggregateForecastMetrics(metricInputs.get(String(horizon))?.get(model.id) ?? []),
        ])
      ),
    ])
  ) as BacktestReport['metrics'];

  const report: BacktestReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      command: [
        'npm run backtest',
        candidateSource ? `-- --candidate-powerlaw ${candidateSource}` : '',
        tauSuite ? '-- --tau-suite' : '',
        cycleSuite ? '-- --cycle-suite' : '',
        residualBootstrapSuite ? '-- --residual-bootstrap-suite' : '',
        ensembleSuite ? '-- --ensemble-suite' : '',
        tailRiskSuite ? '-- --tail-risk-suite' : '',
      ].filter(Boolean).join(' '),
      gitCommit: gitCommit(),
      dataset: {
        firstDate: ohlcv[0]?.date ?? '',
        lastDate: ohlcv[ohlcv.length - 1]?.date ?? '',
        rowCount: ohlcv.length,
      },
      holdoutStartDate: BACKTEST_CONFIG.holdoutStartDate,
      rollingOriginSpacingDays: BACKTEST_CONFIG.rollingOriginSpacingDays,
      skippedWindowCount,
      modelConfig: {
        powerLaw: POWER_LAW_CONFIG,
        interval: INTERVAL_CONFIG,
        backtest: BACKTEST_CONFIG,
      },
      featureTable: loadFeatureTableMetadata(),
    },
    horizons: [...BACKTEST_CONFIG.horizons],
    models: models.map(({ id, description, config }) => ({ id, description, config })),
    metrics,
    qualityGate: evaluateQualityGate(metrics),
    robustness: evaluateRobustness(ohlcv, models),
    regimeSummary: renderRegimeSummary(regimeInputs),
    ablation: buildAblationSummary(metrics),
    candidateComparison: candidate ? evaluateCandidateComparison(metrics, candidate.source) : undefined,
    cycleComparison: cycleSuite ? evaluateCycleComparison(metrics) : undefined,
    residualBootstrapComparison: residualBootstrapSuite ? evaluateResidualBootstrapComparison(ohlcv, models) : undefined,
    ensembleComparison: ensembleSuite && ensembleWeights ? evaluateEnsembleComparison(metrics, ensembleWeights) : undefined,
    tailRiskComparison: tailRiskSuite ? evaluateTailRiskComparison(ohlcv) : undefined,
  };

  writeReports(report);

  const enabledModeFailure = enabledModeGateFailure(report);
  if ((report.qualityGate.status === 'FAIL' || enabledModeFailure) && !process.argv.includes('--report-only')) {
    process.exitCode = 1;
  }
}

function enabledModeGateFailure(report: BacktestReport): boolean {
  if (ENSEMBLE_CONFIG.defaultEnabled && report.ensembleComparison?.status !== 'eligible-for-manual-review') return true;
  if (TAIL_RISK_CONFIG.defaultEnabled && report.tailRiskComparison?.status !== 'eligible-for-manual-review') return true;
  return false;
}

function evaluateRobustness(ohlcv: OHLCVData[], models: ReturnType<typeof getBacktestModels>): BacktestReport['robustness'] {
  const checks: RobustnessCheck[] = [];
  const powerlaw = models.find(model => model.id === 'powerlaw-current');
  const benchmarks = models.filter(model =>
    model.id !== 'powerlaw-current' &&
    model.id !== 'powerlaw-refit-candidate' &&
    !String(model.id).startsWith('powerlaw-tau-') &&
    !String(model.id).startsWith('powerlaw-cycle-') &&
    !String(model.id).startsWith('powerlaw-residual-')
  );
  if (!powerlaw) {
    return {
      status: 'FAIL',
      blockBootstrapIterations: ROBUSTNESS_BOOTSTRAP_ITERATIONS,
      checks: [{
        horizonDays: 0,
        benchmarkModelId: 'naive-current-price',
        samples: 0,
        blockLength: 0,
        medianAbsLogErrorImprovement: null,
        meanAbsLogErrorImprovement: null,
        bootstrapLower95MeanImprovement: null,
        passed: false,
        reason: 'powerlaw-current model was unavailable',
      }],
    };
  }

  for (const horizon of BACKTEST_CONFIG.requiredGateHorizons) {
    for (const benchmark of benchmarks) {
      const paired = pairedErrorImprovements(ohlcv, horizon, powerlaw, benchmark);
      const medianImprovement = median(paired);
      const meanImprovement = mean(paired);
      const blockLength = Math.max(7, Math.min(horizon, 90));
      const lower95 = paired.length > blockLength * 3
        ? blockBootstrapLowerBound(paired, blockLength, ROBUSTNESS_BOOTSTRAP_ITERATIONS, 0xB17C000 + horizon * 997 + benchmark.id.length)
        : null;
      const passed = (
        paired.length > blockLength * 3 &&
        medianImprovement !== null &&
        meanImprovement !== null &&
        lower95 !== null &&
        medianImprovement > 0 &&
        meanImprovement > 0 &&
        lower95 > 0
      );
      checks.push({
        horizonDays: horizon,
        benchmarkModelId: benchmark.id,
        samples: paired.length,
        blockLength,
        medianAbsLogErrorImprovement: medianImprovement,
        meanAbsLogErrorImprovement: meanImprovement,
        bootstrapLower95MeanImprovement: lower95,
        passed,
        reason: passed
          ? `powerlaw-current beat ${benchmark.id} after block-bootstrap overlap adjustment`
          : `powerlaw-current did not clear the block-bootstrap robustness threshold against ${benchmark.id}`,
      });
    }
  }

  return {
    status: checks.every(check => check.passed) ? 'PASS' : 'FAIL',
    blockBootstrapIterations: ROBUSTNESS_BOOTSTRAP_ITERATIONS,
    checks,
  };
}

function pairedErrorImprovements(
  ohlcv: OHLCVData[],
  horizon: number,
  powerlaw: ReturnType<typeof getBacktestModels>[number],
  benchmark: ReturnType<typeof getBacktestModels>[number]
): number[] {
  const improvements: number[] = [];
  for (
    let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
    originIndex + horizon < ohlcv.length;
    originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
  ) {
    const origin = ohlcv[originIndex];
    if (origin.date < BACKTEST_CONFIG.holdoutStartDate) continue;
    if (!isContiguous(ohlcv, originIndex, horizon)) continue;

    const target = ohlcv[originIndex + horizon];
    const powerlawForecast = powerlaw.forecast(ohlcv, originIndex, horizon);
    const benchmarkForecast = benchmark.forecast(ohlcv, originIndex, horizon);
    if (!powerlawForecast?.median || !benchmarkForecast?.median) continue;

    const powerlawError = Math.abs(Math.log(powerlawForecast.median / target.close));
    const benchmarkError = Math.abs(Math.log(benchmarkForecast.median / target.close));
    if (Number.isFinite(powerlawError) && Number.isFinite(benchmarkError)) {
      improvements.push(benchmarkError - powerlawError);
    }
  }
  return improvements;
}

function blockBootstrapLowerBound(values: number[], blockLength: number, iterations: number, seed: number): number | null {
  if (values.length === 0) return null;
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    let sum = 0;
    let count = 0;
    while (count < values.length) {
      const start = Math.floor(rng() * Math.max(1, values.length - blockLength + 1));
      for (let offset = 0; offset < blockLength && count < values.length; offset++, count++) {
        sum += values[start + offset];
      }
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return means[Math.floor(iterations * 0.05)] ?? null;
}

function mulberry32(seed: number) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadFeatureTableMetadata(): BacktestReport['metadata']['featureTable'] {
  const path = join(process.cwd(), 'src', 'data', 'feature-table.json');
  if (!existsSync(path)) return undefined;
  const rows = JSON.parse(readFileSync(path, 'utf8')) as { date: string; features?: Record<string, number> }[];
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  return {
    rowCount: rows.length,
    firstDate: rows[0].date,
    lastDate: rows[rows.length - 1].date,
    latestFeatureCount: Object.keys(rows[rows.length - 1].features ?? {}).length,
  };
}

function loadFeatureRowsByDate(): Map<string, any> {
  const path = join(process.cwd(), 'src', 'data', 'feature-table.json');
  if (!existsSync(path)) return new Map();
  const rows = JSON.parse(readFileSync(path, 'utf8')) as any[];
  if (!Array.isArray(rows)) return new Map();
  return new Map(rows.map(row => [row.date, row]));
}

function buildAblationSummary(metrics: BacktestReport['metrics']): BacktestReport['ablation'] {
  const baselineMetrics = Object.fromEntries(
    BACKTEST_CONFIG.horizons.map(horizon => [String(horizon), metrics[String(horizon)]['powerlaw-current']])
  );

  return {
    modes: [
      {
        id: 'baseline-only',
        enabled: true,
        status: 'baseline',
        reason: 'Calibrated power-law remains the default forecast baseline.',
        metrics: baselineMetrics,
      },
      ...ENSEMBLE_CONFIG.featureFamilies.map(featureFamily => ({
        id: `plus-${featureFamily}`,
        enabled: false,
        status: 'context-only' as const,
        reason: `${featureFamily} signals are loaded for context but not enabled until ablation beats baseline.`,
      })),
      {
        id: 'full-regime-ensemble',
        enabled: false,
        status: 'disabled',
        reason: ENSEMBLE_CONFIG.enablementReason,
      },
    ],
    enablementGate: {
      defaultEnsembleEnabled: ENSEMBLE_CONFIG.defaultEnabled,
      reason: ENSEMBLE_CONFIG.enablementReason,
    },
  };
}

function learnEnsembleWeights(ohlcv: OHLCVData[]): Record<number, Record<string, number>> {
  const members = getBacktestModels().filter(model => ENSEMBLE_CONFIG.candidateMembers.includes(model.id as never));
  const weightsByHorizon: Record<number, Record<string, number>> = {};
  for (const horizon of BACKTEST_CONFIG.requiredGateHorizons) {
    const losses = members.map(model => {
      const errors: number[] = [];
      for (
        let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
        originIndex + horizon < ohlcv.length;
        originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
      ) {
        const origin = ohlcv[originIndex];
        if (origin.date < ENSEMBLE_CONFIG.validationWindow.start || origin.date > ENSEMBLE_CONFIG.validationWindow.end) continue;
        if (!isContiguous(ohlcv, originIndex, horizon)) continue;
        const forecast = model.forecast(ohlcv, originIndex, horizon);
        if (!forecast?.median || forecast.median <= 0) continue;
        errors.push(Math.abs(Math.log(forecast.median / ohlcv[originIndex + horizon].close)));
      }
      return { id: model.id, loss: mean(errors) ?? Infinity };
    });
    const scores = losses.map(item => ({ id: item.id, score: Number.isFinite(item.loss) ? 1 / Math.max(item.loss, 1e-6) : 0 }));
    const total = scores.reduce((sum, item) => sum + item.score, 0);
    weightsByHorizon[horizon] = Object.fromEntries(scores.map(item => [item.id, total > 0 ? item.score / total : 0]));
  }
  return weightsByHorizon;
}

function evaluateEnsembleComparison(
  metrics: BacktestReport['metrics'],
  weightsByHorizon: Record<number, Record<string, number>>
): BacktestReport['ensembleComparison'] {
  const checks = BACKTEST_CONFIG.requiredGateHorizons.map(horizon => {
    const row = metrics[String(horizon)];
    const memberRows = ENSEMBLE_CONFIG.candidateMembers
      .map(id => ({ id, metric: row?.[id as BacktestModelId] }))
      .filter(item => item.metric?.medianAbsLogError !== null && item.metric?.medianAbsLogError !== undefined);
    const best = memberRows.sort((a, b) => (a.metric!.medianAbsLogError ?? Infinity) - (b.metric!.medianAbsLogError ?? Infinity))[0];
    const ensemble = row?.['validation-weighted-ensemble'];
    const bestMedian = best?.metric?.medianAbsLogError ?? null;
    const ensembleMedian = ensemble?.medianAbsLogError ?? null;
    const bestCoverage80 = best?.metric?.coverage.interval80 ?? null;
    const ensembleCoverage80 = ensemble?.coverage.interval80 ?? null;
    const medianOk = bestMedian !== null && ensembleMedian !== null && ensembleMedian <= bestMedian * 1.01;
    const calibrationOk = bestCoverage80 === null || ensembleCoverage80 === null || ensembleCoverage80 >= bestCoverage80 - 0.02;
    const passed = medianOk && calibrationOk;
    return {
      horizonDays: horizon,
      bestSingleModelId: best?.id ?? null,
      bestSingleMedianAbsLogError: bestMedian,
      ensembleMedianAbsLogError: ensembleMedian,
      bestSingleCoverage80: bestCoverage80,
      ensembleCoverage80,
      passed,
      reason: passed
        ? 'ensemble matched best single median error and preserved 80% coverage'
        : [
            medianOk ? null : 'ensemble median error did not match best single',
            calibrationOk ? null : 'ensemble 80% coverage degraded',
          ].filter(Boolean).join('; '),
    };
  });
  const improved = checks.filter(check =>
    check.ensembleMedianAbsLogError !== null &&
    check.bestSingleMedianAbsLogError !== null &&
    check.ensembleMedianAbsLogError < check.bestSingleMedianAbsLogError * 0.995
  );
  const failed = checks.filter(check => !check.passed);
  const status = failed.length === 0 && improved.length > 0
    ? 'eligible-for-manual-review'
    : failed.length <= 1
      ? 'watch'
      : 'disabled';
  return {
    members: [...ENSEMBLE_CONFIG.candidateMembers],
    validationWindow: ENSEMBLE_CONFIG.validationWindow,
    weightsByHorizon: Object.fromEntries(Object.entries(weightsByHorizon).map(([horizon, weights]) => [horizon, weights])),
    status,
    reason: status === 'eligible-for-manual-review'
      ? 'ensemble improved at least one gated horizon and preserved the rest'
      : status === 'watch'
        ? 'ensemble is close but not strong enough for default enablement'
        : 'ensemble did not beat the best single member reliably',
    checks,
  };
}

function evaluateTailRiskComparison(ohlcv: OHLCVData[]): BacktestReport['tailRiskComparison'] {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  const featureRows = loadFeatureRowsByDate();
  if (!powerlaw || featureRows.size === 0) {
    return { status: 'context-only', reason: 'powerlaw model or feature table unavailable', minimumFlaggedSamples: TAIL_RISK_CONFIG.minimumFlaggedSamples, checks: [] };
  }

  const checks = TAIL_RISK_CONFIG.candidateMultipliers.flatMap(multiplier =>
    TAIL_RISK_CONFIG.gatedHorizons.map(horizon => {
      const baseFlagged: MetricInput[] = [];
      const adjustedFlagged: MetricInput[] = [];
      const adjustedNormal: MetricInput[] = [];
      for (
        let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
        originIndex + horizon < ohlcv.length;
        originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
      ) {
        const origin = ohlcv[originIndex];
        if (origin.date < BACKTEST_CONFIG.holdoutStartDate) continue;
        if (!isContiguous(ohlcv, originIndex, horizon)) continue;
        const row = featureRows.get(origin.date);
        const flag = computeTailRisk(row);
        const isFlagged = flag.riskFlag !== 'none';
        const forecast = powerlaw.forecast(ohlcv, originIndex, horizon);
        if (!forecast?.median || !forecast.sigma) continue;
        const target = ohlcv[originIndex + horizon].close;
        const adjusted = scaleForecastSigma(forecast, isFlagged ? multiplier : 1);
        if (isFlagged) {
          baseFlagged.push({ actual: target, forecast });
          adjustedFlagged.push({ actual: target, forecast: adjusted });
        } else {
          adjustedNormal.push({ actual: target, forecast: adjusted });
        }
      }
      const baseFlaggedMetrics = aggregateForecastMetrics(baseFlagged);
      const adjustedFlaggedMetrics = aggregateForecastMetrics(adjustedFlagged);
      const adjustedNormalMetrics = aggregateForecastMetrics(adjustedNormal);
      const enoughSamples = adjustedFlagged.length >= TAIL_RISK_CONFIG.minimumFlaggedSamples;
      const coverageImproved = (
        adjustedFlaggedMetrics.coverage.interval95 !== null &&
        baseFlaggedMetrics.coverage.interval95 !== null &&
        adjustedFlaggedMetrics.coverage.interval95 >= baseFlaggedMetrics.coverage.interval95
      );
      const normalCoverageOk = (adjustedNormalMetrics.coverage.interval95 ?? 0) <= TAIL_RISK_CONFIG.maxNormalCoverage95;
      const normalWidthOk = (adjustedNormalMetrics.intervalWidthRatio.interval95 ?? Infinity) <= TAIL_RISK_CONFIG.maxNormalWidthRatio95;
      const passed = enoughSamples && coverageImproved && normalCoverageOk && normalWidthOk;
      return {
        multiplier,
        horizonDays: horizon,
        flaggedSamples: adjustedFlagged.length,
        normalSamples: adjustedNormal.length,
        baseFlaggedCoverage95: baseFlaggedMetrics.coverage.interval95,
        adjustedFlaggedCoverage95: adjustedFlaggedMetrics.coverage.interval95,
        adjustedNormalCoverage95: adjustedNormalMetrics.coverage.interval95,
        adjustedNormalWidth95: adjustedNormalMetrics.intervalWidthRatio.interval95,
        passed,
        reason: passed
          ? 'flagged-window 95% coverage preserved or improved within normal-period guardrails'
          : [
              enoughSamples ? null : 'insufficient flagged samples',
              coverageImproved ? null : 'flagged 95% coverage did not improve',
              normalCoverageOk ? null : 'normal-period overcoverage too high',
              normalWidthOk ? null : 'normal-period intervals too wide',
            ].filter(Boolean).join('; '),
      };
    })
  );
  const anyPassed = checks.some(check => check.multiplier > 1 && check.passed);
  const sampleStarved = checks.every(check => check.flaggedSamples < TAIL_RISK_CONFIG.minimumFlaggedSamples);
  return {
    status: anyPassed ? 'eligible-for-manual-review' : sampleStarved ? 'context-only' : 'watch',
    reason: anyPassed
      ? 'at least one conditional multiplier improved flagged-window coverage within guardrails'
      : sampleStarved
        ? 'flagged sample counts are insufficient for promotion'
        : 'tail-risk width adjustment did not clear all coverage and width guardrails',
    minimumFlaggedSamples: TAIL_RISK_CONFIG.minimumFlaggedSamples,
    checks,
  };
}

function scaleForecastSigma(forecast: NonNullable<MetricInput['forecast']>, multiplier: number): NonNullable<MetricInput['forecast']> {
  const sigma = (forecast.sigma ?? 0) * multiplier;
  const quantilePrice = (p: number) => forecast.median * Math.exp(sigma * normalQuantile(p));
  return {
    median: forecast.median,
    sigma,
    quantiles: {
      q025: quantilePrice(0.025),
      q05: quantilePrice(0.05),
      q10: quantilePrice(0.10),
      q50: forecast.median,
      q90: quantilePrice(0.90),
      q95: quantilePrice(0.95),
      q975: quantilePrice(0.975),
    },
  };
}

function evaluateCandidateComparison(
  metrics: BacktestReport['metrics'],
  source: string
): BacktestReport['candidateComparison'] {
  const requiredHorizons = [14, 30, 60, 90, 180, 365];
  const checks = requiredHorizons.map(horizon => {
    const row = metrics[String(horizon)];
    const current = row?.['powerlaw-current'];
    const candidate = row?.['powerlaw-refit-candidate'];
    const currentMedian = current?.medianAbsLogError ?? null;
    const candidateMedian = candidate?.medianAbsLogError ?? null;
    const currentBias = current?.biasLogError ?? null;
    const candidateBias = candidate?.biasLogError ?? null;
    const coverage = {
      current80: current?.coverage.interval80 ?? null,
      candidate80: candidate?.coverage.interval80 ?? null,
      current90: current?.coverage.interval90 ?? null,
      candidate90: candidate?.coverage.interval90 ?? null,
      current95: current?.coverage.interval95 ?? null,
      candidate95: candidate?.coverage.interval95 ?? null,
    };
    const intervalWidthRatio = {
      current80: current?.intervalWidthRatio.interval80 ?? null,
      candidate80: candidate?.intervalWidthRatio.interval80 ?? null,
      current90: current?.intervalWidthRatio.interval90 ?? null,
      candidate90: candidate?.intervalWidthRatio.interval90 ?? null,
      current95: current?.intervalWidthRatio.interval95 ?? null,
      candidate95: candidate?.intervalWidthRatio.interval95 ?? null,
    };
    const medianPassed = candidateMedian !== null && currentMedian !== null && candidateMedian <= currentMedian * 1.005;
    const biasPassed = candidateBias !== null && currentBias !== null && Math.abs(candidateBias) <= Math.abs(currentBias) * 1.05 + 0.001;
    const coveragePassed = (
      coverage.candidate80 === null || coverage.current80 === null || coverage.candidate80 >= coverage.current80 - 0.02
    ) && (
      coverage.candidate90 === null || coverage.current90 === null || coverage.candidate90 >= coverage.current90 - 0.02
    ) && (
      coverage.candidate95 === null || coverage.current95 === null || coverage.candidate95 >= coverage.current95 - 0.02
    );
    const passed = medianPassed && biasPassed && coveragePassed;
    return {
      horizonDays: horizon,
      currentMedianAbsLogError: currentMedian,
      candidateMedianAbsLogError: candidateMedian,
      currentBiasLogError: currentBias,
      candidateBiasLogError: candidateBias,
      coverage,
      intervalWidthRatio,
      passed,
      reason: passed
        ? 'candidate preserved median error, bias, and 80/90/95% interval coverage'
        : [
            medianPassed ? null : 'median error degraded',
            biasPassed ? null : 'bias degraded',
            coveragePassed ? null : '80/90/95% coverage degraded',
          ].filter(Boolean).join('; '),
    };
  });

  const failed = checks.filter(check => !check.passed);
  const status = failed.length === 0
    ? 'eligible-for-manual-config-update'
    : failed.length <= 2
      ? 'watch'
      : 'disabled';

  return {
    candidateModelId: 'powerlaw-refit-candidate',
    source,
    status,
    reasons: failed.length === 0
      ? ['Candidate preserved or improved required current-model metrics across all comparison horizons.']
      : failed.map(check => `${check.horizonDays}d ${check.reason}`),
    checks,
  };
}

function evaluateCycleComparison(metrics: BacktestReport['metrics']): BacktestReport['cycleComparison'] {
  const baselineModelId = 'powerlaw-cycle-deterministic-pivots' as const;
  const candidateOrder: BacktestModelId[] = [
    'powerlaw-cycle-no-future-pivots',
    'powerlaw-cycle-damped-future-pivots',
    'powerlaw-cycle-pivot-uncertainty-wide',
    baselineModelId,
  ];
  const checks = candidateOrder.flatMap(modelId =>
    CYCLE_EXPERIMENT_CONFIG.gatedHorizons.map(horizon => {
      const row = metrics[String(horizon)];
      const current = row?.[baselineModelId];
      const candidate = row?.[modelId];
      const currentMedian = current?.medianAbsLogError ?? null;
      const candidateMedian = candidate?.medianAbsLogError ?? null;
      const currentCoverage80 = current?.coverage.interval80 ?? null;
      const candidateCoverage80 = candidate?.coverage.interval80 ?? null;
      const currentCoverage90 = current?.coverage.interval90 ?? null;
      const candidateCoverage90 = candidate?.coverage.interval90 ?? null;
      const currentCoverage95 = current?.coverage.interval95 ?? null;
      const candidateCoverage95 = candidate?.coverage.interval95 ?? null;
      const medianPassed = candidateMedian !== null && currentMedian !== null && candidateMedian <= currentMedian * 1.005;
      const coveragePassed = (
        candidateCoverage80 !== null && currentCoverage80 !== null && candidateCoverage80 >= currentCoverage80 - 0.02 &&
        candidateCoverage90 !== null && currentCoverage90 !== null && candidateCoverage90 >= currentCoverage90 - 0.02 &&
        candidateCoverage95 !== null && currentCoverage95 !== null && candidateCoverage95 >= currentCoverage95 - 0.02
      );
      const passed = medianPassed && coveragePassed;
      return {
        modelId,
        horizonDays: horizon,
        currentMedianAbsLogError: currentMedian,
        candidateMedianAbsLogError: candidateMedian,
        currentCoverage80,
        candidateCoverage80,
        currentCoverage90,
        candidateCoverage90,
        currentCoverage95,
        candidateCoverage95,
        passed,
        reason: passed
          ? 'strategy preserved median error and 80/90/95% coverage versus deterministic pivots'
          : [
              medianPassed ? null : 'median error degraded',
              coveragePassed ? null : '80/90/95% coverage degraded',
            ].filter(Boolean).join('; '),
      };
    })
  );
  const firstEligible = candidateOrder.find(modelId =>
    checks.filter(check => check.modelId === modelId).every(check => check.passed)
  ) ?? baselineModelId;
  const selectedModelId = firstEligible;
  const selectedStrategyId = String(selectedModelId).replace('powerlaw-cycle-', '');
  const status = selectedModelId === baselineModelId
    ? 'retain-deterministic'
    : selectedStrategyId === CYCLE_EXPERIMENT_CONFIG.selectedStrategyId
      ? 'selected-default'
      : 'eligible-for-manual-review';
  return {
    baselineModelId,
    selectedModelId,
    status,
    reason: status === 'selected-default'
      ? `${selectedModelId} is the selected runtime strategy because it is the least assumption-heavy tested strategy that preserved deterministic-pivot median error and coverage at ${CYCLE_EXPERIMENT_CONFIG.gatedHorizons.join('/')} day horizons.`
      : status === 'eligible-for-manual-review'
        ? `${selectedModelId} is the least assumption-heavy tested strategy that preserved deterministic-pivot median error and coverage at ${CYCLE_EXPERIMENT_CONFIG.gatedHorizons.join('/')} day horizons. Manual runtime promotion is still required.`
        : `Deterministic future pivots remain the selected runtime strategy because no less assumption-heavy strategy preserved median error and 80/90/95% coverage at ${CYCLE_EXPERIMENT_CONFIG.gatedHorizons.join('/')} day horizons.`,
    checks,
  };
}

function evaluateResidualBootstrapComparison(
  ohlcv: OHLCVData[],
  models: ReturnType<typeof getBacktestModels>
): BacktestReport['residualBootstrapComparison'] {
  const residualModels = models.filter(model => String(model.id).startsWith('powerlaw-residual-'));
  const baselineModelId = 'powerlaw-residual-recent-730d' as const;
  const cutoff = highVolatilityCutoff(ohlcv);
  const byModel = new Map<BacktestModelId, Map<string, { all: MetricInput[]; highVol: MetricInput[]; normal: MetricInput[] }>>();

  for (const model of residualModels) {
    byModel.set(model.id, new Map(RESIDUAL_BOOTSTRAP_CONFIG.gatedHorizons.map(horizon => [
      String(horizon),
      { all: [], highVol: [], normal: [] },
    ])));
  }

  for (const horizon of RESIDUAL_BOOTSTRAP_CONFIG.gatedHorizons) {
    for (
      let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
      originIndex + horizon < ohlcv.length;
      originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
    ) {
      const origin = ohlcv[originIndex];
      if (origin.date < BACKTEST_CONFIG.holdoutStartDate) continue;
      if (!isContiguous(ohlcv, originIndex, horizon)) continue;
      const target = ohlcv[originIndex + horizon];
      const isHighVol = trailingVolatility(ohlcv, originIndex, 30) >= cutoff;
      for (const model of residualModels) {
        const forecast = model.forecast(ohlcv, originIndex, horizon);
        if (!forecast || !Number.isFinite(forecast.median) || forecast.median <= 0) continue;
        const input = { actual: target.close, forecast };
        const bucket = byModel.get(model.id)?.get(String(horizon));
        bucket?.all.push(input);
        if (isHighVol) bucket?.highVol.push(input);
        else bucket?.normal.push(input);
      }
    }
  }

  const baseline = byModel.get(baselineModelId);
  const checks = residualModels.flatMap(model =>
    RESIDUAL_BOOTSTRAP_CONFIG.gatedHorizons.map(horizon => {
      const bucket = byModel.get(model.id)?.get(String(horizon));
      const baseBucket = baseline?.get(String(horizon));
      const overall = aggregateForecastMetrics(bucket?.all ?? []);
      const highVol = aggregateForecastMetrics(bucket?.highVol ?? []);
      const normal = aggregateForecastMetrics(bucket?.normal ?? []);
      const baseHighVol = aggregateForecastMetrics(baseBucket?.highVol ?? []);
      const highVolCoverage95 = highVol.coverage.interval95;
      const baselineHighVolCoverage95 = baseHighVol.coverage.interval95;
      const normalIntervalWidth95 = normal.intervalWidthRatio.interval95;
      const coveragePassed = highVolCoverage95 !== null && baselineHighVolCoverage95 !== null && highVolCoverage95 >= baselineHighVolCoverage95 - 0.01;
      const widthPassed = normalIntervalWidth95 !== null && normalIntervalWidth95 <= RESIDUAL_BOOTSTRAP_CONFIG.normalPeriodMaxWidthRatio;
      const passed = coveragePassed && widthPassed;
      return {
        modelId: model.id,
        horizonDays: horizon,
        overallCoverage95: overall.coverage.interval95,
        highVolCoverage95,
        normalIntervalWidth95,
        passed,
        reason: passed
          ? 'policy preserved high-volatility 95% coverage without over-widening normal periods'
          : [
              coveragePassed ? null : 'high-volatility 95% coverage degraded',
              widthPassed ? null : 'normal-period intervals too wide',
            ].filter(Boolean).join('; '),
      };
    })
  );

  const candidateOrder: BacktestModelId[] = [
    'powerlaw-residual-recent-730d',
    'powerlaw-residual-full-history',
    'powerlaw-residual-vol-regime-stratified',
  ];
  const firstEligible = candidateOrder.find(modelId =>
    checks.filter(check => check.modelId === modelId).every(check => check.passed)
  ) ?? baselineModelId;
  const status = firstEligible === baselineModelId ? 'retain-recent' : 'eligible-for-manual-review';

  return {
    baselineModelId,
    selectedModelId: firstEligible,
    status,
    reason: status === 'eligible-for-manual-review'
      ? `${firstEligible} preserved high-volatility coverage while keeping normal-period interval widths inside guardrails. Runtime promotion remains manual.`
      : 'The recent-730d residual policy remains selected because no alternative cleared the high-volatility coverage and normal-period width guardrails.',
    highVolatilityCutoff: cutoff,
    checks,
  };
}

function renderRegimeSummary(regimeInputs: Map<string, Map<RegimeState, MetricInput[]>>): BacktestReport['regimeSummary'] {
  return Object.fromEntries(
    [...regimeInputs.entries()].map(([horizon, byState]) => [
      horizon,
      Object.fromEntries([...byState.entries()].map(([state, inputs]) => [state, aggregateForecastMetrics(inputs)])),
    ])
  ) as BacktestReport['regimeSummary'];
}

function evaluateQualityGate(metrics: BacktestReport['metrics']): BacktestReport['qualityGate'] {
  const checks = BACKTEST_CONFIG.requiredGateHorizons.map(horizon => {
    const row = metrics[String(horizon)];
    const powerlaw = row?.['powerlaw-current']?.medianAbsLogError ?? null;
    const naive = row?.['naive-current-price']?.medianAbsLogError ?? null;
    const passed = powerlaw !== null && naive !== null && powerlaw < naive;
    return {
      horizonDays: horizon,
      powerlawMedianAbsLogError: powerlaw,
      naiveMedianAbsLogError: naive,
      passed,
      reason: passed
        ? `powerlaw-current median absolute log error ${formatMetric(powerlaw)} beat naive ${formatMetric(naive)}`
        : `powerlaw-current median absolute log error ${formatMetric(powerlaw)} did not beat naive ${formatMetric(naive)}`,
    };
  });

  return {
    status: checks.every(check => check.passed) ? 'PASS' : 'FAIL',
    checks,
  };
}

function writeReports(report: BacktestReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.metadata.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `backtest-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `backtest-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`Backtest quality gate: ${report.qualityGate.status}`);
  for (const check of report.qualityGate.checks) {
    console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.horizonDays}d: ${check.reason}`);
  }
  console.log(`Backtest robustness audit: ${report.robustness.status}`);
  for (const check of report.robustness.checks) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} ${check.horizonDays}d vs ${check.benchmarkModelId}: mean improvement ${formatMetric(check.meanAbsLogErrorImprovement)}, bootstrap lower95 ${formatMetric(check.bootstrapLower95MeanImprovement)}`
    );
  }
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function renderMarkdown(report: BacktestReport): string {
  const lines = [
    '# Forecast Backtest Report',
    '',
    `Generated: ${report.metadata.generatedAt}`,
    `Command: \`${report.metadata.command}\``,
    `Git commit: \`${report.metadata.gitCommit}\``,
    `Dataset: ${report.metadata.dataset.firstDate} to ${report.metadata.dataset.lastDate} (${report.metadata.dataset.rowCount} rows)`,
    `Horizon days: ${report.horizons.join(', ')}`,
    `Rolling-origin spacing: ${report.metadata.rollingOriginSpacingDays} days`,
    `Skipped windows: ${report.metadata.skippedWindowCount}`,
    '',
    `## Quality Gate: ${report.qualityGate.status}`,
    '',
    '| Horizon | Result | Reason |',
    '| --- | --- | --- |',
    ...report.qualityGate.checks.map(check => `| ${check.horizonDays}d | ${check.passed ? 'PASS' : 'FAIL'} | ${check.reason} |`),
    '',
    `## Robustness Audit: ${report.robustness.status}`,
    '',
    `Block bootstrap iterations: ${report.robustness.blockBootstrapIterations}`,
    '',
    '| Horizon | Benchmark | Samples | Block length | Median improvement | Mean improvement | 5% bootstrap mean improvement | Result |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.robustness.checks.map(check => [
      `| ${check.horizonDays}d`,
      `\`${check.benchmarkModelId}\``,
      check.samples,
      check.blockLength,
      formatMetric(check.medianAbsLogErrorImprovement),
      formatMetric(check.meanAbsLogErrorImprovement),
      formatMetric(check.bootstrapLower95MeanImprovement),
      check.passed ? 'PASS' : 'FAIL',
      '|',
    ].join(' | ')),
    '',
    'Positive values mean `powerlaw-current` had lower absolute log error than the benchmark. The bootstrap samples contiguous blocks so overlapping rolling-origin windows are not treated as independent daily observations.',
    '',
    '## Metrics',
    '',
  ];

  for (const horizon of report.horizons) {
    lines.push(`### ${horizon} Day Horizon`, '');
    lines.push('| Model | Samples | Median abs log error | Approx mult error | Bias log error | NLL | Pinball q05/q10/q50/q90/q95 | 80% / 90% / 95% coverage |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');

    for (const model of report.models) {
      const metric = report.metrics[String(horizon)][model.id];
      lines.push([
        `| \`${model.id}\``,
        metric.samples,
        formatMetric(metric.medianAbsLogError),
        formatPercent(metric.approximateMultiplicativeError),
        formatMetric(metric.biasLogError),
        formatMetric(metric.nll),
        [
          formatMetric(metric.pinballLoss.q05),
          formatMetric(metric.pinballLoss.q10),
          formatMetric(metric.pinballLoss.q50),
          formatMetric(metric.pinballLoss.q90),
          formatMetric(metric.pinballLoss.q95),
        ].join(' / '),
        `${formatPercent(metric.coverage.interval80)} / ${formatPercent(metric.coverage.interval90)} / ${formatPercent(metric.coverage.interval95)}`,
        '|',
      ].join(' | '));
    }
    lines.push('');
  }

  lines.push('## Regime Summary', '');
  if (report.regimeSummary) {
    for (const horizon of report.horizons) {
      const byState = report.regimeSummary[String(horizon)] ?? {};
      lines.push(`### ${horizon} Day Horizon`, '');
      lines.push('| Top state | Samples | Median abs log error | Bias log error |');
      lines.push('| --- | ---: | ---: | ---: |');
      for (const [state, metric] of Object.entries(byState)) {
        lines.push(`| \`${state}\` | ${metric.samples} | ${formatMetric(metric.medianAbsLogError)} | ${formatMetric(metric.biasLogError)} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('No feature table was available for regime grouping.', '');
  }

  lines.push('## Ablation And Enablement', '');
  lines.push(`Default ensemble enabled: ${report.ablation.enablementGate.defaultEnsembleEnabled ? 'yes' : 'no'}`);
  lines.push(report.ablation.enablementGate.reason, '');
  lines.push('| Mode | Status | Enabled | Reason |');
  lines.push('| --- | --- | --- | --- |');
  for (const mode of report.ablation.modes) {
    lines.push(`| \`${mode.id}\` | ${mode.status} | ${mode.enabled ? 'yes' : 'no'} | ${mode.reason} |`);
  }
  lines.push('');

  lines.push('## Power-Law Refit Candidate', '');
  if (report.candidateComparison) {
    lines.push(`Source: \`${report.candidateComparison.source}\``);
    lines.push(`Enablement status: ${report.candidateComparison.status}`, '');
    lines.push('| Horizon | Result | Current median error | Candidate median error | Current bias | Candidate bias | Current coverage 80/90/95 | Candidate coverage 80/90/95 | Current width 80/90/95 | Candidate width 80/90/95 | Reason |');
    lines.push('| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |');
    for (const check of report.candidateComparison.checks) {
      lines.push([
        `| ${check.horizonDays}d`,
        check.passed ? 'PASS' : 'FAIL',
        formatMetric(check.currentMedianAbsLogError),
        formatMetric(check.candidateMedianAbsLogError),
        formatMetric(check.currentBiasLogError),
        formatMetric(check.candidateBiasLogError),
        [formatPercent(check.coverage.current80), formatPercent(check.coverage.current90), formatPercent(check.coverage.current95)].join(' / '),
        [formatPercent(check.coverage.candidate80), formatPercent(check.coverage.candidate90), formatPercent(check.coverage.candidate95)].join(' / '),
        [formatPercent(check.intervalWidthRatio.current80), formatPercent(check.intervalWidthRatio.current90), formatPercent(check.intervalWidthRatio.current95)].join(' / '),
        [formatPercent(check.intervalWidthRatio.candidate80), formatPercent(check.intervalWidthRatio.candidate90), formatPercent(check.intervalWidthRatio.candidate95)].join(' / '),
        check.reason,
        '|',
      ].join(' | '));
    }
    lines.push('');
  } else {
    lines.push('No candidate was supplied. Run `npm run backtest -- --candidate-powerlaw latest` after `npm run refit:powerlaw` to compare refit coefficients.', '');
  }

  lines.push('## Cycle Strategy Suite', '');
  if (report.cycleComparison) {
    lines.push(`Baseline: \`${report.cycleComparison.baselineModelId}\``);
    lines.push(`Selected: \`${report.cycleComparison.selectedModelId}\``);
    lines.push(`Status: ${report.cycleComparison.status}`);
    lines.push(report.cycleComparison.reason, '');
    lines.push(`Promotion policy: ${CYCLE_EXPERIMENT_CONFIG.promotionPolicy}`, '');
    lines.push('| Strategy | Horizon | Result | Current median error | Candidate median error | Current coverage 80/90/95 | Candidate coverage 80/90/95 | Reason |');
    lines.push('| --- | ---: | --- | ---: | ---: | --- | --- | --- |');
    for (const check of report.cycleComparison.checks) {
      lines.push([
        `| \`${check.modelId}\``,
        `${check.horizonDays}d`,
        check.passed ? 'PASS' : 'FAIL',
        formatMetric(check.currentMedianAbsLogError),
        formatMetric(check.candidateMedianAbsLogError),
        [formatPercent(check.currentCoverage80), formatPercent(check.currentCoverage90), formatPercent(check.currentCoverage95)].join(' / '),
        [formatPercent(check.candidateCoverage80), formatPercent(check.candidateCoverage90), formatPercent(check.candidateCoverage95)].join(' / '),
        check.reason,
        '|',
      ].join(' | '));
    }
    lines.push('');
  } else {
    lines.push('Not run. Use `npm run backtest -- --cycle-suite` to compare deterministic pivots, no future pivots, damped pivots, and pivot-uncertainty intervals.', '');
  }

  lines.push('## Residual Bootstrap Suite', '');
  if (report.residualBootstrapComparison) {
    lines.push(`Baseline: \`${report.residualBootstrapComparison.baselineModelId}\``);
    lines.push(`Selected: \`${report.residualBootstrapComparison.selectedModelId}\``);
    lines.push(`Status: ${report.residualBootstrapComparison.status}`);
    lines.push(report.residualBootstrapComparison.reason, '');
    lines.push(`High-volatility cutoff: ${formatPercent(report.residualBootstrapComparison.highVolatilityCutoff)}`);
    lines.push(`Promotion policy: ${RESIDUAL_BOOTSTRAP_CONFIG.promotionPolicy}`, '');
    lines.push('2020-style shock windows are represented by the high-volatility flagged-period slice; full-history and volatility-regime policies show whether broader shock residuals improve 95% coverage without over-widening normal periods.', '');
    lines.push('### Coverage In Flagged Periods', '');
    lines.push('| Policy | Horizon | Result | Overall 95% coverage | High-vol 95% coverage | Normal-period 95% width | Reason |');
    lines.push('| --- | ---: | --- | ---: | ---: | ---: | --- |');
    for (const check of report.residualBootstrapComparison.checks) {
      lines.push([
        `| \`${check.modelId}\``,
        `${check.horizonDays}d`,
        check.passed ? 'PASS' : 'FAIL',
        formatPercent(check.overallCoverage95),
        formatPercent(check.highVolCoverage95),
        formatPercent(check.normalIntervalWidth95),
        check.reason,
        '|',
      ].join(' | '));
    }
    lines.push('');
  } else {
    lines.push('Not run. Use `npm run backtest -- --residual-bootstrap-suite` to compare recent, full-history, and volatility-regime residual policies.', '');
  }

  lines.push('## Ensemble Suite', '');
  if (report.ensembleComparison) {
    lines.push(`Status: ${report.ensembleComparison.status}`);
    lines.push(report.ensembleComparison.reason, '');
    lines.push(`Validation window: ${report.ensembleComparison.validationWindow.start} to ${report.ensembleComparison.validationWindow.end}`);
    lines.push(`Members: ${report.ensembleComparison.members.map(id => `\`${id}\``).join(', ')}`, '');
    lines.push('| Horizon | Best single | Best median error | Ensemble median error | Best 80% coverage | Ensemble 80% coverage | Weights | Result | Reason |');
    lines.push('| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- |');
    for (const check of report.ensembleComparison.checks) {
      const weights = report.ensembleComparison.weightsByHorizon[String(check.horizonDays)] ?? {};
      lines.push([
        `| ${check.horizonDays}d`,
        check.bestSingleModelId ? `\`${check.bestSingleModelId}\`` : 'n/a',
        formatMetric(check.bestSingleMedianAbsLogError),
        formatMetric(check.ensembleMedianAbsLogError),
        formatPercent(check.bestSingleCoverage80),
        formatPercent(check.ensembleCoverage80),
        Object.entries(weights).map(([id, weight]) => `${id}:${formatPercent(weight)}`).join('<br>'),
        check.passed ? 'PASS' : 'FAIL',
        check.reason,
        '|',
      ].join(' | '));
    }
    lines.push('');
  } else {
    lines.push('Not run. Use `npm run backtest -- --ensemble-suite` to compare validation-weighted ensemble candidates against the best single member.', '');
  }

  lines.push('## Tail-Risk Suite', '');
  if (report.tailRiskComparison) {
    lines.push(`Status: ${report.tailRiskComparison.status}`);
    lines.push(report.tailRiskComparison.reason, '');
    lines.push(`Minimum flagged samples: ${report.tailRiskComparison.minimumFlaggedSamples}`, '');
    lines.push(`Sample warning: flagged windows below ${report.tailRiskComparison.minimumFlaggedSamples} samples block promotion even if coverage appears better.`, '');
    lines.push('| Multiplier | Horizon | Flagged samples | Normal samples | Base flagged 95% | Adjusted flagged 95% | Adjusted normal 95% | Normal width 95% | Result | Reason |');
    lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
    for (const check of report.tailRiskComparison.checks) {
      lines.push([
        `| ${check.multiplier.toFixed(2)}x`,
        `${check.horizonDays}d`,
        check.flaggedSamples,
        check.normalSamples,
        formatPercent(check.baseFlaggedCoverage95),
        formatPercent(check.adjustedFlaggedCoverage95),
        formatPercent(check.adjustedNormalCoverage95),
        formatPercent(check.adjustedNormalWidth95),
        check.passed ? 'PASS' : 'FAIL',
        check.reason,
        '|',
      ].join(' | '));
    }
    lines.push('');
  } else {
    lines.push('Not run. Use `npm run backtest -- --tail-risk-suite` to evaluate conditional interval-width multipliers on flagged windows.', '');
  }

  lines.push('## Model Config Snapshot', '', '```json', JSON.stringify(report.metadata.modelConfig, null, 2), '```', '');
  return `${lines.join('\n')}\n`;
}

function highVolatilityCutoff(ohlcv: OHLCVData[]): number {
  const values: number[] = [];
  for (
    let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
    originIndex < ohlcv.length - 1;
    originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
  ) {
    if (ohlcv[originIndex].date < BACKTEST_CONFIG.holdoutStartDate) continue;
    values.push(trailingVolatility(ohlcv, originIndex, 30));
  }
  values.sort((a, b) => a - b);
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  return values[Math.floor((values.length - 1) * RESIDUAL_BOOTSTRAP_CONFIG.highVolQuantile)];
}

function trailingVolatility(ohlcv: OHLCVData[], endIndex: number, lookback: number): number {
  const returns: number[] = [];
  const start = Math.max(1, endIndex - lookback + 1);
  for (let index = start; index <= endIndex; index++) {
    const previous = ohlcv[index - 1];
    const current = ohlcv[index];
    if (previous?.close > 0 && current?.close > 0) returns.push(Math.log(current.close / previous.close));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  return Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1));
}

function parseCandidateArg(args: string[]): string | null {
  const index = args.indexOf('--candidate-powerlaw');
  if (index < 0) return null;
  return args[index + 1] ?? 'latest';
}

function loadCandidateConfig(sourceArg: string): { source: string; coefficients: PowerLawFitCoefficients } {
  const source = sourceArg === 'latest' ? latestRefitReportPath() : sourceArg;
  const report = JSON.parse(readFileSync(source, 'utf8')) as { suggestedConfig?: PowerLawFitCoefficients };
  if (!report.suggestedConfig) {
    throw new Error(`Candidate report ${source} does not include suggestedConfig`);
  }
  return { source, coefficients: report.suggestedConfig };
}

function latestRefitReportPath(): string {
  const reports = readdirSync(REPORT_DIR)
    .filter(file => /^powerlaw-refit-.*\.json$/.test(file))
    .sort();
  const latest = reports[reports.length - 1];
  if (!latest) {
    throw new Error('No powerlaw-refit JSON reports found. Run npm run refit:powerlaw first.');
  }
  return join(REPORT_DIR, latest);
}

function isContiguous(data: OHLCVData[], start: number, horizon: number): boolean {
  for (let step = 0; step < horizon; step++) {
    const current = parseDate(data[start + step].date);
    const next = parseDate(data[start + step + 1].date);
    if ((next.getTime() - current.getTime()) / 86400000 !== 1) return false;
  }
  return true;
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function formatMetric(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(5);
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

main();
