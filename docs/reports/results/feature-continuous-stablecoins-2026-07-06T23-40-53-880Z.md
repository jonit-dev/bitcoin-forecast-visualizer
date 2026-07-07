# Continuous Feature Residual Experiment Report

Generated: 2026-07-06T23:40:53.880Z
Command: `npm run backtest:features-continuous -- --family stablecoins`
Git commit: `84d1321b94c3d32e6e1b9f8cfee8532d1a7be99d`
BTC rows: 5828 (2010-07-17 to 2026-06-30)
Feature rows: 5827 (2010-07-18 to 2026-06-30)
Holdout starts: 2022-01-01, 2025-01-01
Horizons: 7, 14, 30, 60, 90, 180
Model: pre-holdout ridge regression on standardized family features, lambda=1
Primary metric: mean pinball loss across q10/q50/q90 residual quantiles

**Sparse-gate warning:** legacy rare-event/state outputs are diagnostics only and are not a promotion gate. Continuous residual gates below are the promotion evidence for PRD v2.9.

## stablecoins

Status: ready
Features: `stablecoinSupplyUSD`, `stablecoinSupplyChange7d`, `stablecoinSupplyChange30d`, `stablecoinSupplyChange90d`, `stablecoinSupplyChange365d`, `stablecoinSupplyZ365d`, `stablecoinLiquidityImpulse30dVsAnnual`, `stablecoinSupplyToBtcMarketCap`

### Sample counts

| Holdout | Horizon | Raw rows | Lag-safe rows | Filtered rows | Missing row | Future source date | Missing feature | Invalid forecast |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-01-01 | 7d | 1635 | 1635 | 1635 | 0 | 0 | 0 | 0 | |
| 2022-01-01 | 14d | 1628 | 1628 | 1628 | 0 | 0 | 0 | 0 | |
| 2022-01-01 | 30d | 1612 | 1612 | 1612 | 0 | 0 | 0 | 0 | |
| 2022-01-01 | 60d | 1582 | 1582 | 1582 | 0 | 0 | 0 | 0 | |
| 2022-01-01 | 90d | 1552 | 1552 | 1552 | 0 | 0 | 0 | 0 | |
| 2022-01-01 | 180d | 1462 | 1462 | 1462 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 7d | 539 | 539 | 539 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 14d | 532 | 532 | 532 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 30d | 516 | 516 | 516 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 60d | 486 | 486 | 486 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 90d | 456 | 456 | 456 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 180d | 366 | 366 | 366 | 0 | 0 | 0 | 0 | |

### Continuous gates

| Holdout | Horizon | Train | Eval | Status | Pinball improvement | Lower95 | Model 80% cov | Reason |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| 2022-01-01 | 7d | 1128 | 1635 | context-only | -0.01264 | -0.01870 | 0.67156 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 14d | 1128 | 1628 | context-only | -0.03000 | -0.04163 | 0.62285 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 30d | 1128 | 1612 | context-only | -0.08239 | -0.10907 | 0.55025 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 60d | 1128 | 1582 | context-only | -0.18101 | -0.24251 | 0.55879 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 90d | 1128 | 1552 | context-only | -0.22593 | -0.30681 | 0.56186 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 180d | 1128 | 1462 | context-only | -0.11644 | -0.16362 | 0.59302 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 7d | 2224 | 539 | watch | 0.00006 | -0.00005 | 0.93135 | mean pinball improves, but bootstrap lower95 is not positive | |
| 2025-01-01 | 14d | 2224 | 532 | watch | 0.00015 | -0.00021 | 0.93233 | mean pinball improves, but bootstrap lower95 is not positive | |
| 2025-01-01 | 30d | 2224 | 516 | context-only | -0.00009 | -0.00057 | 0.93217 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 60d | 2224 | 486 | context-only | -0.00033 | -0.00279 | 1.00000 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 90d | 2224 | 456 | context-only | -0.00375 | -0.01078 | 1.00000 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 180d | 2224 | 366 | watch | 0.00251 | -0.00660 | 1.00000 | mean pinball improves, but bootstrap lower95 is not positive | |

