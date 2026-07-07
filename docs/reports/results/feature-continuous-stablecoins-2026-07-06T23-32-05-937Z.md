# Continuous Feature Residual Dataset Report

Generated: 2026-07-06T23:32:05.937Z
Command: `npm run backtest:features-continuous -- --family stablecoins`
Git commit: `84d1321b94c3d32e6e1b9f8cfee8532d1a7be99d`
BTC rows: 5828 (2010-07-17 to 2026-06-30)
Feature rows: 5827 (2010-07-18 to 2026-06-30)
Holdout starts: 2022-01-01, 2025-01-01
Horizons: 7, 14, 30, 60, 90, 180

This Phase 1 report only validates lag-safe sample availability. Continuous residual-model metrics and promotion gates are added in later PRD v2.9 phases.

## stablecoins

Status: ready
Features: `stablecoinSupplyUSD`, `stablecoinSupplyChange7d`, `stablecoinSupplyChange30d`, `stablecoinSupplyChange90d`, `stablecoinSupplyChange365d`, `stablecoinSupplyZ365d`, `stablecoinLiquidityImpulse30dVsAnnual`, `stablecoinSupplyToBtcMarketCap`

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

