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
