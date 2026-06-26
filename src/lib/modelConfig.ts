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

export const ENSEMBLE_CONFIG = {
  defaultEnabled: false,
  enablementReason: 'Regime signals are context-only until ablation beats the calibrated power-law baseline out of sample.',
  weights: {
    powerlaw: 1,
    regimeAdjustment: 0,
  },
  featureFamilies: ['mvrv', 'onchain', 'volatility', 'macro', 'derivatives', 'etf-flow', 'sentiment'],
} as const;
