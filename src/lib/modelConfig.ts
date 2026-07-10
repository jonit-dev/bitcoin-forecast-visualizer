export const POWER_LAW_CONFIG = {
  genesisDate: '2009-01-03T00:00:00Z',
  meanReversionTauDays: 210,
  peak: {
    coefficient: 9.89e-7,
    exponent: 2.9379,
  },
  floor: {
    rawCoefficient: Math.exp(-40.234),
    rawExponent: 5.847,
    cyclicCoefficient: 9.48e-10,
    cyclicExponent: 3.6702,
    sinAmplitude: 0.2323,
    cosAmplitude: 0.4288,
  },
  base: {
    coefficient: 9.48e-10,
    exponent: 3.6702,
    sinAmplitude: 0.2323,
    cosAmplitude: 0.4288,
    cycleDays: 1460,
  },
} as const;

export const INTERVAL_CONFIG = {
  recentVolWeight: 0.55,
  logDriftScale: 0.3,
  stressMultiplier: {
    base: 1,
    amplitude: 1.85,
    tauDays: 150,
  },
  fittedMultipliers: [
    { horizonDays: 14, multiplier: 1.01, coverageStatus: 'calibrated', label: 'Calibrated' },
    { horizonDays: 30, multiplier: 0.98, coverageStatus: 'calibrated', label: 'Calibrated' },
    { horizonDays: 60, multiplier: 0.99, coverageStatus: 'conservative', label: 'Conservative' },
    { horizonDays: 90, multiplier: 0.87, coverageStatus: 'calibrated', label: 'Calibrated' },
    { horizonDays: 180, multiplier: 0.86, coverageStatus: 'scenario', label: 'Scenario range' },
    { horizonDays: 365, multiplier: 0.59, coverageStatus: 'scenario', label: 'Scenario range' },
  ],
  scenarioPolicy: {
    maxFittedHorizonDays: 365,
    aboveMaxMultiplier: 0.59,
    label: 'Scenario range',
  },
} as const;

export const BACKTEST_CONFIG = {
  horizons: [7, 14, 30, 60, 90, 180, 365],
  requiredGateHorizons: [14, 30, 60, 90],
  rollingOriginSpacingDays: 1,
  minimumLookbackDays: 365,
  holdoutStartDate: '2022-01-01',
  benchmarkModels: [
    'naive-current-price',
    'gbm-driftless',
    'gbm-recent-drift',
    'ma-trend-20-50-200',
    'powerlaw-current',
  ],
} as const;

export const TAU_EXPERIMENT_CONFIG = {
  defaultTauDays: 210,
  fixedCandidates: [60, 90, 120, 150, 210, 300, 420],
  gatedHorizons: [14, 30, 60, 90],
  volatilityConditional: {
    id: 'powerlaw-tau-vol-conditional',
    lowVolDailyThreshold: 0.02,
    highVolDailyThreshold: 0.04,
    lowVolTauDays: 300,
    normalTauDays: 210,
    highVolTauDays: 120,
  },
  promotionPolicy: 'Report-only. Retain 210 unless a candidate beats or matches median error, bias, NLL, pinball loss, and 80/90/95 coverage at every gated horizon.',
} as const;

export const CYCLE_EXPERIMENT_CONFIG = {
  selectedStrategyId: 'no-future-pivots',
  candidateStrategyIds: [
    'deterministic-pivots',
    'no-future-pivots',
    'damped-future-pivots',
    'pivot-uncertainty-wide',
  ],
  gatedHorizons: [90, 180, 365],
  futureAmplitudeDecay: 0.65,
  pivotUncertaintySigmaMultiplier: 1.18,
  promotionPolicy: 'Report-only. Prefer the least assumption-heavy cycle strategy that preserves or improves median error and 80/90/95 coverage at 90, 180, and 365 day horizons.',
} as const;

export const RESIDUAL_BOOTSTRAP_CONFIG = {
  selectedPolicyId: 'recent-730d',
  candidatePolicyIds: ['recent-730d', 'full-history', 'vol-regime-stratified'],
  gatedHorizons: [90, 180, 365],
  blockDays: 14,
  simulations: 16,
  recentLookbackDays: 730,
  highVolQuantile: 0.75,
  normalPeriodMaxWidthRatio: 3.5,
  promotionPolicy: 'Report-only. Prefer the smallest residual-bootstrap interval policy that improves high-volatility 95% coverage without making normal-period intervals uselessly wide.',
} as const;

export const RESIDUAL_MODEL_CONFIG = {
  defaultEnabled: false,
  modelId: 'kitchen-sink-ridge-residual',
  lambda: 5,
  minimumTrainingRows: 730,
  evaluationSpacingDays: 14,
  holdoutStarts: ['2022-01-01', '2025-01-01'],
  horizons: [7, 14, 30, 60, 90, 180],
  promotionPolicy: 'Report-only. Keep disabled unless walk-forward residual modeling improves mean q10/q50/q90 pinball loss without degrading 80% residual coverage.',
} as const;

export interface YellowLineForecastCandidateConfig {
  enabled: boolean;
  candidateId: 'structural-shrinkage' | 'state-space-residual' | null;
  horizons: readonly (14 | 30 | 60 | 90)[];
  evidenceArtifact: string | null;
  evidenceSha256: string | null;
  configSha256: string | null;
}

/** Phase 5 rejection state. Historical development evidence cannot enable a
 * candidate; this remains disabled until the prospective protocol reaches its
 * stopping rule and an exact evidence/config hash passes the release gate. */
export const YELLOW_LINE_FORECAST_CONFIG: YellowLineForecastCandidateConfig = Object.freeze({
  enabled: false,
  candidateId: null,
  horizons: Object.freeze([]),
  evidenceArtifact: null,
  evidenceSha256: null,
  configSha256: null,
});

export function validateYellowLineForecastConfig(config: YellowLineForecastCandidateConfig): void {
  if (!config.enabled) return;
  if (!config.candidateId || config.horizons.length === 0) {
    throw new Error('enabled yellow-line candidate must identify a candidate and at least one validated horizon');
  }
  if (!config.evidenceArtifact?.startsWith('docs/reports/results/') || !config.evidenceSha256 || !config.configSha256) {
    throw new Error('enabled yellow-line candidate requires an exact results artifact, evidence hash, and config hash');
  }
  if (new Set(config.horizons).size !== config.horizons.length) {
    throw new Error('enabled yellow-line candidate horizons must be unique');
  }
}

export const TAIL_RISK_CONFIG = {
  defaultEnabled: false,
  candidateMultipliers: [1, 1.1, 1.2, 1.35],
  gatedHorizons: [30, 60, 90],
  minimumFlaggedSamples: 60,
  maxNormalCoverage95: 0.985,
  maxNormalWidthRatio95: 2.8,
  promotionPolicy: 'Report-only. Tail-risk may widen intervals but cannot move median; keep disabled unless flagged-window coverage improves without excessive normal-period overcoverage or width.',
} as const;

export const ENSEMBLE_CONFIG = {
  defaultEnabled: false,
  enablementReason: 'Regime signals are context-only until ablation beats the calibrated power-law baseline out of sample.',
  candidateMembers: ['powerlaw-current', 'gbm-recent-drift', 'ma-trend-20-50-200'],
  candidateWeights: {
    '14': { 'powerlaw-current': 1, 'gbm-recent-drift': 0, 'ma-trend-20-50-200': 0 },
    '30': { 'powerlaw-current': 1, 'gbm-recent-drift': 0, 'ma-trend-20-50-200': 0 },
    '60': { 'powerlaw-current': 1, 'gbm-recent-drift': 0, 'ma-trend-20-50-200': 0 },
    '90': { 'powerlaw-current': 1, 'gbm-recent-drift': 0, 'ma-trend-20-50-200': 0 },
  },
  validationWindow: {
    start: '2022-01-01',
    end: '2024-12-31',
  },
  weights: {
    powerlaw: 1,
    regimeAdjustment: 0,
  },
  featureFamilies: ['mvrv', 'onchain', 'volatility', 'macro', 'derivatives', 'etf-flow', 'sentiment'],
} as const;
