# BTC Candidate Forecast Research

Generated: 2026-06-12T22:33:06.945Z

## Data

BTC rows: 5809 (2010-07-17 to 2026-06-11)
Feature rows: 5801 (2010-07-18 to 2026-06-04)

## Pre-Registered Evaluation

Target: BTC daily close endpoint price
Validation: 2022-01-01 through 2024-12-31
Final holdout: 2025-01-01 through latest available target
Horizons: 7, 14, 30, 60, 90, 180, 365
Primary metric: median absolute log error
Split policy: Candidates are selected only by 2022-2024 validation average across 14/30/60/90d horizons; 2025+ is final holdout.
Leakage policy: Feature adjustments use feature-table rows keyed by origin date; feature sources are one day lagged by build-feature-table.ts.

## Tau Validation Grid

| Tau days | Validation avg median abs log error |
| ---: | ---: |
| 60 | 0.112890 |
| 90 | 0.111526 |
| 120 | 0.111918 |
| 150 | 0.112402 |
| 180 | 0.113509 |
| 210 | 0.114608 |
| 240 | 0.115804 |
| 270 | 0.116504 |
| 300 | 0.117096 |
| 365 | 0.118120 |
| 450 | 0.119017 |

## Final Holdout Results

#### Baseline: powerlaw-current

| Horizon | Samples | Median abs log error | Mean abs log error | Mean improvement vs current | Bootstrap lower 95% |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7d | 520 | 0.033799 | 0.042080 | 0.000000 | 0.000000 | |
| 14d | 513 | 0.048593 | 0.060272 | 0.000000 | 0.000000 | |
| 30d | 497 | 0.065880 | 0.086816 | 0.000000 | 0.000000 | |
| 60d | 467 | 0.125609 | 0.124396 | 0.000000 | 0.000000 | |
| 90d | 437 | 0.134064 | 0.132639 | 0.000000 | 0.000000 | |
| 180d | 347 | 0.122045 | 0.148426 | 0.000000 | 0.000000 | |
| 365d | 162 | 0.133217 | 0.154367 | 0.000000 | n/a | |

### tau-90
Power-law residual mean-reversion tau selected on validation grid; current default is 210 days.
Validation avg median abs log error: 0.111526

#### 2025+ final holdout

| Horizon | Samples | Median abs log error | Mean abs log error | Mean improvement vs current | Bootstrap lower 95% |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7d | 520 | 0.033112 | 0.041745 | 0.000335 | -0.000335 | |
| 14d | 513 | 0.048989 | 0.059387 | 0.000886 | -0.000585 | |
| 30d | 497 | 0.064578 | 0.082569 | 0.004247 | 0.000193 | |
| 60d | 467 | 0.108136 | 0.114187 | 0.010209 | -0.001040 | |
| 90d | 437 | 0.108929 | 0.120910 | 0.011728 | -0.001050 | |
| 180d | 347 | 0.109920 | 0.132876 | 0.015550 | 0.017089 | |
| 365d | 162 | 0.162182 | 0.160024 | -0.005657 | n/a | |

### momentumTiny
Small continuation adjustment from one-day-lagged 30d residual momentum, capped at +/-0.08 log points.
Validation avg median abs log error: 0.115540

#### 2025+ final holdout

| Horizon | Samples | Median abs log error | Mean abs log error | Mean improvement vs current | Bootstrap lower 95% |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7d | 520 | 0.034804 | 0.041927 | 0.000154 | -0.000315 | |
| 14d | 513 | 0.048789 | 0.060274 | -0.000002 | -0.001221 | |
| 30d | 497 | 0.068791 | 0.088251 | -0.001435 | -0.004367 | |
| 60d | 467 | 0.127877 | 0.125683 | -0.001287 | -0.006651 | |
| 90d | 437 | 0.140733 | 0.133796 | -0.001157 | -0.004057 | |
| 180d | 347 | 0.129068 | 0.152885 | -0.004459 | -0.009346 | |
| 365d | 162 | 0.128242 | 0.152693 | 0.001674 | n/a | |

### valueRevert
Small mean-reversion adjustment from one-day-lagged power-law residual, capped at +/-0.10 log points.
Validation avg median abs log error: 0.113182

#### 2025+ final holdout

| Horizon | Samples | Median abs log error | Mean abs log error | Mean improvement vs current | Bootstrap lower 95% |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7d | 520 | 0.033712 | 0.041979 | 0.000101 | -0.000037 | |
| 14d | 513 | 0.048212 | 0.059978 | 0.000294 | -0.000007 | |
| 30d | 497 | 0.065509 | 0.085623 | 0.001193 | 0.000463 | |
| 60d | 467 | 0.118504 | 0.121033 | 0.003363 | -0.000081 | |
| 90d | 437 | 0.124805 | 0.128255 | 0.004383 | -0.000144 | |
| 180d | 347 | 0.116548 | 0.142929 | 0.005497 | 0.005988 | |
| 365d | 162 | 0.150580 | 0.157923 | -0.003555 | n/a | |

### mvrvValue
Contrarian MVRV percentile adjustment: +0.04 below 25th percentile, -0.04 above 85th percentile.
Validation avg median abs log error: 0.116035

#### 2025+ final holdout

| Horizon | Samples | Median abs log error | Mean abs log error | Mean improvement vs current | Bootstrap lower 95% |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7d | 520 | 0.033859 | 0.042031 | 0.000049 | -0.000060 | |
| 14d | 513 | 0.048440 | 0.060041 | 0.000231 | -0.000012 | |
| 30d | 497 | 0.064884 | 0.086191 | 0.000625 | 0.000089 | |
| 60d | 467 | 0.120115 | 0.122279 | 0.002117 | 0.000000 | |
| 90d | 437 | 0.126793 | 0.130808 | 0.001831 | 0.000000 | |
| 180d | 347 | 0.122045 | 0.148426 | 0.000000 | 0.000000 | |
| 365d | 162 | 0.133217 | 0.154367 | 0.000000 | n/a | |

### bearPenalty
Bear-regime penalty when drawdown is below -35% and 30d residual momentum is negative.
Validation avg median abs log error: 0.116670

#### 2025+ final holdout

| Horizon | Samples | Median abs log error | Mean abs log error | Mean improvement vs current | Bootstrap lower 95% |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7d | 520 | 0.033680 | 0.042043 | 0.000037 | -0.000098 | |
| 14d | 513 | 0.048171 | 0.060381 | -0.000109 | -0.000437 | |
| 30d | 497 | 0.066409 | 0.087357 | -0.000540 | -0.001549 | |
| 60d | 467 | 0.129228 | 0.126771 | -0.002375 | -0.006253 | |
| 90d | 437 | 0.137144 | 0.135062 | -0.002423 | -0.002838 | |
| 180d | 347 | 0.122045 | 0.148426 | 0.000000 | 0.000000 | |
| 365d | 162 | 0.133217 | 0.154367 | 0.000000 | n/a | |

## Decision

All candidate changes are research-only unless their paired mean improvement has a positive lower 95% block-bootstrap bound across the required horizons and they do not degrade median error on the final holdout.
