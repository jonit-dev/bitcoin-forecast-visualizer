# Continuous Feature Residual Experiment Report

Generated: 2026-07-07T00:13:44.633Z
Command: `npm run backtest:features-continuous`
Git commit: `84d1321b94c3d32e6e1b9f8cfee8532d1a7be99d`
BTC rows: 5828 (2010-07-17 to 2026-06-30)
Feature rows: 5827 (2010-07-18 to 2026-06-30)
Holdout starts: 2022-01-01, 2025-01-01
Horizons: 7, 14, 30, 60, 90, 180
Model: pre-holdout ridge regression on standardized family features, lambda=1
Primary metric: mean pinball loss across q10/q50/q90 residual quantiles
Holdout policy: 2022-01-01 is the primary longer-window gate where history exists; 2025-01-01 is retained as a short recent diagnostic window.

**Sparse-gate warning:** legacy rare-event/state outputs are diagnostics only and are not a promotion gate. Continuous residual gates below are the promotion evidence for PRD v2.9.

## onchain

Status: ready
Features: `mvrvLevel`, `mvrvPercentile`, `mvrvZScore`, `realizedPriceDistance`, `activeAddresses`, `transactionCount`, `transferCount`, `addressBalanceCount`, `transfersPerTransaction`, `activeAddressShare`, `hashRate`, `minerStressProxy`

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
| 2022-01-01 | 7d | 3653 | 1635 | context-only | -0.00997 | -0.01256 | 0.69908 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 14d | 3653 | 1628 | context-only | -0.03180 | -0.03931 | 0.55405 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 30d | 3653 | 1612 | context-only | -0.06815 | -0.08649 | 0.46216 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 60d | 3653 | 1582 | context-only | -0.16429 | -0.20867 | 0.38053 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 90d | 3653 | 1552 | context-only | -0.13920 | -0.18160 | 0.43170 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 180d | 3653 | 1462 | context-only | -0.06931 | -0.10069 | 0.52462 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 7d | 4749 | 539 | context-only | 0.00056 | -0.00083 | 0.93878 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 14d | 4749 | 532 | context-only | 0.00199 | -0.00067 | 0.93421 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 30d | 4749 | 516 | context-only | 0.00431 | -0.00373 | 0.91860 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 60d | 4749 | 486 | context-only | 0.01475 | -0.00030 | 0.95679 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 90d | 4749 | 456 | context-only | 0.01522 | -0.00412 | 0.95833 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 180d | 4749 | 366 | context-only | 0.02434 | 0.00155 | 0.96175 | continuous residual gate did not beat the current residual-decay baseline | |

## derivatives

Status: sample-starved
Features: `futuresFundingRateDailyAvg`, `futuresFundingRateDailySum`, `futuresFundingRateSum7d`, `futuresFundingRateSum30d`, `futuresFundingRateSumZ90d`, `futuresFundingRateAvgZ90d`, `futuresPremiumClose`, `futuresPremiumCloseZ90d`, `futuresPremiumRange`, `futuresOpenInterestUSD`, `futuresOpenInterestToMarketCap`

### Sample counts

| Holdout | Horizon | Raw rows | Lag-safe rows | Filtered rows | Missing row | Future source date | Missing feature | Invalid forecast |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-01-01 | 7d | 1635 | 1635 | 15 | 0 | 0 | 1620 | 0 | |
| 2022-01-01 | 14d | 1628 | 1628 | 8 | 0 | 0 | 1620 | 0 | |
| 2022-01-01 | 30d | 1612 | 1612 | 0 | 0 | 0 | 1612 | 0 | |
| 2022-01-01 | 60d | 1582 | 1582 | 0 | 0 | 0 | 1582 | 0 | |
| 2022-01-01 | 90d | 1552 | 1552 | 0 | 0 | 0 | 1552 | 0 | |
| 2022-01-01 | 180d | 1462 | 1462 | 0 | 0 | 0 | 1462 | 0 | |
| 2025-01-01 | 7d | 539 | 539 | 15 | 0 | 0 | 524 | 0 | |
| 2025-01-01 | 14d | 532 | 532 | 8 | 0 | 0 | 524 | 0 | |
| 2025-01-01 | 30d | 516 | 516 | 0 | 0 | 0 | 516 | 0 | |
| 2025-01-01 | 60d | 486 | 486 | 0 | 0 | 0 | 486 | 0 | |
| 2025-01-01 | 90d | 456 | 456 | 0 | 0 | 0 | 456 | 0 | |
| 2025-01-01 | 180d | 366 | 366 | 0 | 0 | 0 | 366 | 0 | |

### Continuous gates

| Holdout | Horizon | Train | Eval | Status | Pinball improvement | Lower95 | Model 80% cov | Reason |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| 2022-01-01 | 7d | 0 | 15 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=15; minimum=60 | |
| 2022-01-01 | 14d | 0 | 8 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=8; minimum=60 | |
| 2022-01-01 | 30d | 0 | 0 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=0; minimum=60 | |
| 2022-01-01 | 60d | 0 | 0 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=0; minimum=60 | |
| 2022-01-01 | 90d | 0 | 0 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=0; minimum=60 | |
| 2022-01-01 | 180d | 0 | 0 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=0; minimum=60 | |
| 2025-01-01 | 7d | 0 | 15 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=15; minimum=60 | |
| 2025-01-01 | 14d | 0 | 8 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=8; minimum=60 | |
| 2025-01-01 | 30d | 0 | 0 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=0; minimum=60 | |
| 2025-01-01 | 60d | 0 | 0 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=0; minimum=60 | |
| 2025-01-01 | 90d | 0 | 0 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=0; minimum=60 | |
| 2025-01-01 | 180d | 0 | 0 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=0; minimum=60 | |

## etf

Status: ready
Features: `spotEtfFlowUSD`, `spotEtfFlow5dUSD`, `spotEtfFlow20dUSD`, `spotEtfCumulativeFlowUSD`, `spotEtfFlowToBtcMarketCap`, `spotEtfFlow20dToBtcMarketCap`, `spotEtfFlow5dToBtcMarketCap`, `spotEtfFlowShockZ90d`

### Sample counts

| Holdout | Horizon | Raw rows | Lag-safe rows | Filtered rows | Missing row | Future source date | Missing feature | Invalid forecast |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-01-01 | 7d | 1635 | 1635 | 768 | 0 | 0 | 867 | 0 | |
| 2022-01-01 | 14d | 1628 | 1628 | 761 | 0 | 0 | 867 | 0 | |
| 2022-01-01 | 30d | 1612 | 1612 | 745 | 0 | 0 | 867 | 0 | |
| 2022-01-01 | 60d | 1582 | 1582 | 715 | 0 | 0 | 867 | 0 | |
| 2022-01-01 | 90d | 1552 | 1552 | 685 | 0 | 0 | 867 | 0 | |
| 2022-01-01 | 180d | 1462 | 1462 | 595 | 0 | 0 | 867 | 0 | |
| 2025-01-01 | 7d | 539 | 539 | 539 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 14d | 532 | 532 | 532 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 30d | 516 | 516 | 516 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 60d | 486 | 486 | 486 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 90d | 456 | 456 | 456 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 180d | 366 | 366 | 366 | 0 | 0 | 0 | 0 | |

### Continuous gates

| Holdout | Horizon | Train | Eval | Status | Pinball improvement | Lower95 | Model 80% cov | Reason |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| 2022-01-01 | 7d | 0 | 768 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=768; minimum=60 | |
| 2022-01-01 | 14d | 0 | 761 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=761; minimum=60 | |
| 2022-01-01 | 30d | 0 | 745 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=745; minimum=60 | |
| 2022-01-01 | 60d | 0 | 715 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=715; minimum=60 | |
| 2022-01-01 | 90d | 0 | 685 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=685; minimum=60 | |
| 2022-01-01 | 180d | 0 | 595 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=595; minimum=60 | |
| 2025-01-01 | 7d | 229 | 539 | context-only | -0.02806 | -0.03511 | 0.27644 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 14d | 229 | 532 | context-only | -0.06215 | -0.07684 | 0.17669 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 30d | 229 | 516 | context-only | -0.18349 | -0.22545 | 0.02326 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 60d | 229 | 486 | context-only | -0.24291 | -0.30570 | 0.02469 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 90d | 229 | 456 | context-only | -0.34488 | -0.45035 | 0.04386 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 180d | 229 | 366 | context-only | -0.01084 | -0.04637 | 0.25410 | continuous residual gate did not beat the current residual-decay baseline | |

## macro

Status: ready
Features: `macroFedBalanceSheetChange13w`, `macroFedBalanceSheetChange26w`, `macroFedFundsRate`, `macroFedFundsChange13w`, `macroTreasury10yYield`, `macroTreasury10yChange30d`, `macroTreasury10yChange90d`, `macroHighYieldSpread`, `macroHighYieldSpreadZ252d`, `macroM2Change26w`, `macroLiquidityImpulseZ252d`, `macroRiskScore`

### Sample counts

| Holdout | Horizon | Raw rows | Lag-safe rows | Filtered rows | Missing row | Future source date | Missing feature | Invalid forecast |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-01-01 | 7d | 1635 | 1635 | 933 | 0 | 0 | 702 | 0 | |
| 2022-01-01 | 14d | 1628 | 1628 | 926 | 0 | 0 | 702 | 0 | |
| 2022-01-01 | 30d | 1612 | 1612 | 910 | 0 | 0 | 702 | 0 | |
| 2022-01-01 | 60d | 1582 | 1582 | 880 | 0 | 0 | 702 | 0 | |
| 2022-01-01 | 90d | 1552 | 1552 | 850 | 0 | 0 | 702 | 0 | |
| 2022-01-01 | 180d | 1462 | 1462 | 760 | 0 | 0 | 702 | 0 | |
| 2025-01-01 | 7d | 539 | 539 | 539 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 14d | 532 | 532 | 532 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 30d | 516 | 516 | 516 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 60d | 486 | 486 | 486 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 90d | 456 | 456 | 456 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 180d | 366 | 366 | 366 | 0 | 0 | 0 | 0 | |

### Continuous gates

| Holdout | Horizon | Train | Eval | Status | Pinball improvement | Lower95 | Model 80% cov | Reason |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| 2022-01-01 | 7d | 0 | 933 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=933; minimum=60 | |
| 2022-01-01 | 14d | 0 | 926 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=926; minimum=60 | |
| 2022-01-01 | 30d | 0 | 910 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=910; minimum=60 | |
| 2022-01-01 | 60d | 0 | 880 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=880; minimum=60 | |
| 2022-01-01 | 90d | 0 | 850 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=850; minimum=60 | |
| 2022-01-01 | 180d | 0 | 760 | not-evaluated | n/a | n/a | n/a | sample-starved train=0 eval=760; minimum=60 | |
| 2025-01-01 | 7d | 394 | 539 | context-only | -0.02152 | -0.02803 | 0.37848 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 14d | 394 | 532 | context-only | -0.01294 | -0.01971 | 0.62406 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 30d | 394 | 516 | context-only | -0.00570 | -0.01606 | 0.75969 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 60d | 394 | 486 | context-only | -0.06953 | -0.11812 | 0.39300 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 90d | 394 | 456 | context-only | -0.26151 | -0.34042 | 0.21711 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 180d | 394 | 366 | context-only | -0.15910 | -0.22694 | 0.24590 | continuous residual gate did not beat the current residual-decay baseline | |

## sentiment

Status: ready
Features: `fearGreedIndex`, `fearGreedChange7d`, `fearGreedChange30d`, `extremeFearEvent`, `extremeGreedEvent`, `fearGreedResidualDivergence`

### Sample counts

| Holdout | Horizon | Raw rows | Lag-safe rows | Filtered rows | Missing row | Future source date | Missing feature | Invalid forecast |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-01-01 | 7d | 1635 | 1635 | 1634 | 0 | 0 | 1 | 0 | |
| 2022-01-01 | 14d | 1628 | 1628 | 1627 | 0 | 0 | 1 | 0 | |
| 2022-01-01 | 30d | 1612 | 1612 | 1611 | 0 | 0 | 1 | 0 | |
| 2022-01-01 | 60d | 1582 | 1582 | 1581 | 0 | 0 | 1 | 0 | |
| 2022-01-01 | 90d | 1552 | 1552 | 1551 | 0 | 0 | 1 | 0 | |
| 2022-01-01 | 180d | 1462 | 1462 | 1461 | 0 | 0 | 1 | 0 | |
| 2025-01-01 | 7d | 539 | 539 | 539 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 14d | 532 | 532 | 532 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 30d | 516 | 516 | 516 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 60d | 486 | 486 | 486 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 90d | 456 | 456 | 456 | 0 | 0 | 0 | 0 | |
| 2025-01-01 | 180d | 366 | 366 | 366 | 0 | 0 | 0 | 0 | |

### Continuous gates

| Holdout | Horizon | Train | Eval | Status | Pinball improvement | Lower95 | Model 80% cov | Reason |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| 2022-01-01 | 7d | 1396 | 1634 | context-only | -0.00066 | -0.00100 | 0.89780 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 14d | 1396 | 1627 | context-only | -0.00073 | -0.00155 | 0.90904 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 30d | 1396 | 1611 | context-only | -0.00192 | -0.00493 | 0.93482 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 60d | 1396 | 1581 | context-only | -0.00360 | -0.00656 | 0.92536 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 90d | 1396 | 1551 | context-only | -0.00266 | -0.00673 | 0.94326 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 180d | 1396 | 1461 | context-only | -0.00160 | -0.00587 | 0.94661 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 7d | 2491 | 539 | context-only | -0.00024 | -0.00053 | 0.92950 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 14d | 2491 | 532 | watch | 0.00022 | -0.00033 | 0.93985 | mean pinball improves, but bootstrap lower95 is not positive | |
| 2025-01-01 | 30d | 2491 | 516 | context-only | -0.00023 | -0.00194 | 0.94380 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 60d | 2491 | 486 | watch | 0.00090 | -0.00155 | 0.99794 | mean pinball improves, but bootstrap lower95 is not positive | |
| 2025-01-01 | 90d | 2491 | 456 | watch | 0.00317 | -0.00009 | 1.00000 | mean pinball improves, but bootstrap lower95 is not positive | |
| 2025-01-01 | 180d | 2491 | 366 | context-only | -0.00009 | -0.00367 | 1.00000 | continuous residual gate did not beat the current residual-decay baseline | |

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

## cot

Status: ready
Features: `cmeCotOpenInterestBtc`, `cmeCotLeveragedMoneyNetPctOi`, `cmeCotLeveragedMoneyNetPctRank`, `cmeCotAssetManagerNetPctOi`, `cmeCotAssetManagerNetPctRank`, `cmeCotDealerNetPctOi`, `cmeCotDealerNetPctRank`, `cmeCotOpenInterestChange4w`, `cmeCotOpenInterestPctRank`

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
| 2022-01-01 | 7d | 994 | 1635 | context-only | -0.00731 | -0.00987 | 0.74862 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 14d | 994 | 1628 | context-only | -0.00536 | -0.00879 | 0.82862 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 30d | 994 | 1612 | context-only | -0.00615 | -0.01016 | 0.87283 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 60d | 994 | 1582 | context-only | -0.08382 | -0.11041 | 0.39760 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 90d | 994 | 1552 | context-only | -0.14841 | -0.19944 | 0.49420 | continuous residual gate did not beat the current residual-decay baseline | |
| 2022-01-01 | 180d | 994 | 1462 | context-only | -0.30893 | -0.38228 | 0.27907 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 7d | 2090 | 539 | watch | 0.00009 | -0.00008 | 0.93878 | mean pinball improves, but bootstrap lower95 is not positive | |
| 2025-01-01 | 14d | 2090 | 532 | watch | 0.00002 | -0.00059 | 0.93045 | mean pinball improves, but bootstrap lower95 is not positive | |
| 2025-01-01 | 30d | 2090 | 516 | context-only | -0.00005 | -0.00282 | 0.89147 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 60d | 2090 | 486 | eligible-for-manual-review | 0.00346 | 0.00167 | 0.99794 | pinball improvement lower95 is positive without material 80% coverage degradation | |
| 2025-01-01 | 90d | 2090 | 456 | context-only | 0.00193 | -0.00290 | 0.96053 | continuous residual gate did not beat the current residual-decay baseline | |
| 2025-01-01 | 180d | 2090 | 366 | eligible-for-manual-review | 0.01467 | 0.01124 | 0.99727 | pinball improvement lower95 is positive without material 80% coverage degradation | |

