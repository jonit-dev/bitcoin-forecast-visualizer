# BTC Canonical Technical-Indicator Reversal Study

Generated: 2026-07-13T18:13:05.322Z

Decision: **rejected-no-confirmed-signal**. Runtime implementation authorized: **no**.

## Claim

Four canonical close-confirmed indicators are tested for direction-adjusted 30-day BTC reversal information after 20bp round-trip cost. Signals execute only from the next UTC open.

## Data

Checked-in BTC OHLCV: 2010-07-17 through 2026-07-09, 5837 rows, SHA-256 `23b947fb572a724e75314608e57d56203b734f0cd134a389a30c9d264fab4919`. Scoring starts 2018-01-01; 2022+ is a frozen historical family holdout, not pristine prospective data.

Quality: 0 gaps, 0 duplicates, 32 malformed legacy rows, 0 malformed scored rows.

## Pre-registered 30-day holdout results

| Indicator | N | 30d episodes | Up/down | Net excess | CI block 30 | CI block 60 | CI block 90 | raw p | Holm 4 | Holm 11 | Dev | Gate |
|---|---:|---:|---:|---:|---|---|---|---:|---:|---:|---:|---|
| rsi14-extreme-exit | 47 | 21 | 18/29 | -1.34% | [-5.57%, 2.51%] | [-5.62%, 2.71%] | [-5.69%, 2.79%] | 0.27421 | 0.82264 | 1.00000 | -6.14% | FAIL |
| bollinger20x2-reentry | 98 | 15 | 42/56 | -0.69% | [-4.06%, 2.67%] | [-3.83%, 2.74%] | [-3.54%, 2.42%] | 0.45365 | 0.89234 | 1.00000 | -5.07% | FAIL |
| stochastic14x3-extreme-cross | 131 | 15 | 52/79 | -1.47% | [-4.93%, 2.11%] | [-4.78%, 2.14%] | [-4.36%, 1.87%] | 0.44617 | 0.89234 | 1.00000 | -3.24% | FAIL |
| macd12x26x9-opposite-zero-cross | 76 | 15 | 37/39 | 0.36% | [-3.62%, 4.17%] | [-3.76%, 4.50%] | [-3.84%, 4.32%] | 0.18178 | 0.72711 | 1.00000 | 1.39% | FAIL |

Positive excess means the event beat the direction-adjusted period drift after costs. The promotion p-value is Holm-adjusted across all seven prior MA rules and four new indicator rules.

## Gate failures

- **rsi14-extreme-exit:** development mean effect is not positive; holdout mean effect is below 1%; 30d-block bootstrap lower bound is not positive; 60d-block bootstrap lower bound is not positive; 90d-block bootstrap lower bound is not positive; search-history Holm p=1.00000 is not below 0.05; a direction effect is below -0.50%; 2022-2024 effect is not positive; 2025+ effect is not positive.
- **bollinger20x2-reentry:** distinct 30-day episodes 15 < 20; development mean effect is not positive; holdout mean effect is below 1%; 30d-block bootstrap lower bound is not positive; 60d-block bootstrap lower bound is not positive; 90d-block bootstrap lower bound is not positive; search-history Holm p=1.00000 is not below 0.05; a direction effect is below -0.50%; 2022-2024 effect is not positive.
- **stochastic14x3-extreme-cross:** distinct 30-day episodes 15 < 20; development mean effect is not positive; holdout mean effect is below 1%; 30d-block bootstrap lower bound is not positive; 60d-block bootstrap lower bound is not positive; 90d-block bootstrap lower bound is not positive; search-history Holm p=1.00000 is not below 0.05; a direction effect is below -0.50%; 2022-2024 effect is not positive; 2025+ effect is not positive.
- **macd12x26x9-opposite-zero-cross:** distinct 30-day episodes 15 < 20; holdout mean effect is below 1%; 30d-block bootstrap lower bound is not positive; 60d-block bootstrap lower bound is not positive; 90d-block bootstrap lower bound is not positive; search-history Holm p=1.00000 is not below 0.05; a direction effect is below -0.50%; 2022-2024 effect is not positive.

## Secondary horizon diagnostics

| Indicator | Period | h | N | Episodes | Excess | Win rate | Up excess | Down excess | Max DD |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rsi14-extreme-exit | development-2018-2021 | 7 | 56 | 17 | -3.28% | 39.29% | -2.25% | -3.74% | -70.60% |
| rsi14-extreme-exit | development-2018-2021 | 14 | 56 | 17 | -4.30% | 35.71% | -2.28% | -5.18% | -82.42% |
| rsi14-extreme-exit | development-2018-2021 | 30 | 55 | 16 | -6.14% | 38.18% | -2.03% | -7.83% | -87.38% |
| rsi14-extreme-exit | development-2018-2021 | 60 | 55 | 16 | -9.84% | 40.00% | -10.55% | -9.55% | -89.06% |
| rsi14-extreme-exit | development-2018-2021 | 90 | 52 | 15 | -18.28% | 32.69% | -7.73% | -22.97% | -92.03% |
| rsi14-extreme-exit | historical-holdout-2022+ | 7 | 50 | 22 | -0.06% | 44.00% | 1.02% | -0.85% | -39.12% |
| rsi14-extreme-exit | historical-holdout-2022+ | 14 | 48 | 22 | -0.26% | 37.50% | 1.28% | -1.27% | -47.74% |
| rsi14-extreme-exit | historical-holdout-2022+ | 30 | 47 | 21 | -1.34% | 51.06% | -0.29% | -2.00% | -61.72% |
| rsi14-extreme-exit | historical-holdout-2022+ | 60 | 47 | 21 | 0.85% | 55.32% | 1.67% | 0.34% | -56.62% |
| rsi14-extreme-exit | historical-holdout-2022+ | 90 | 47 | 21 | -1.64% | 46.81% | -1.06% | -2.01% | -81.74% |
| bollinger20x2-reentry | development-2018-2021 | 7 | 85 | 16 | -3.24% | 36.47% | -3.70% | -2.94% | -96.48% |
| bollinger20x2-reentry | development-2018-2021 | 14 | 85 | 16 | -3.51% | 38.82% | -2.92% | -3.90% | -96.54% |
| bollinger20x2-reentry | development-2018-2021 | 30 | 84 | 16 | -5.07% | 36.90% | -4.03% | -5.74% | -98.70% |
| bollinger20x2-reentry | development-2018-2021 | 60 | 82 | 15 | -6.61% | 46.34% | -6.19% | -6.88% | -91.26% |
| bollinger20x2-reentry | development-2018-2021 | 90 | 81 | 15 | -10.65% | 41.98% | -6.19% | -13.56% | -96.31% |
| bollinger20x2-reentry | historical-holdout-2022+ | 7 | 99 | 15 | 0.19% | 51.52% | 1.34% | -0.69% | -36.59% |
| bollinger20x2-reentry | historical-holdout-2022+ | 14 | 98 | 15 | 0.54% | 51.02% | -0.80% | 1.54% | -50.74% |
| bollinger20x2-reentry | historical-holdout-2022+ | 30 | 98 | 15 | -0.69% | 47.96% | -1.72% | 0.09% | -65.61% |
| bollinger20x2-reentry | historical-holdout-2022+ | 60 | 96 | 15 | -1.31% | 56.25% | -3.57% | 0.31% | -81.15% |
| bollinger20x2-reentry | historical-holdout-2022+ | 90 | 94 | 15 | -2.95% | 51.06% | -6.34% | -0.43% | -86.51% |
| stochastic14x3-extreme-cross | development-2018-2021 | 7 | 108 | 14 | -2.11% | 39.81% | -2.53% | -1.96% | -87.09% |
| stochastic14x3-extreme-cross | development-2018-2021 | 14 | 108 | 14 | -2.88% | 44.44% | -4.71% | -2.25% | -94.27% |
| stochastic14x3-extreme-cross | development-2018-2021 | 30 | 108 | 14 | -3.24% | 39.81% | -5.84% | -2.33% | -96.61% |
| stochastic14x3-extreme-cross | development-2018-2021 | 60 | 105 | 14 | -8.73% | 44.76% | -11.13% | -7.94% | -84.16% |
| stochastic14x3-extreme-cross | development-2018-2021 | 90 | 99 | 13 | -13.92% | 43.43% | -14.00% | -13.90% | -95.40% |
| stochastic14x3-extreme-cross | historical-holdout-2022+ | 7 | 132 | 15 | -0.47% | 46.21% | 0.32% | -1.00% | -47.11% |
| stochastic14x3-extreme-cross | historical-holdout-2022+ | 14 | 131 | 15 | -0.97% | 43.51% | -0.25% | -1.45% | -53.85% |
| stochastic14x3-extreme-cross | historical-holdout-2022+ | 30 | 131 | 15 | -1.47% | 45.80% | 0.10% | -2.50% | -39.95% |
| stochastic14x3-extreme-cross | historical-holdout-2022+ | 60 | 127 | 15 | -0.92% | 50.39% | 0.41% | -1.72% | -35.26% |
| stochastic14x3-extreme-cross | historical-holdout-2022+ | 90 | 124 | 15 | -2.86% | 40.32% | -2.05% | -3.37% | -78.15% |
| macd12x26x9-opposite-zero-cross | development-2018-2021 | 7 | 64 | 18 | -0.14% | 43.75% | -0.37% | 0.10% | -57.83% |
| macd12x26x9-opposite-zero-cross | development-2018-2021 | 14 | 63 | 17 | 1.37% | 55.56% | 0.00% | 2.77% | -60.58% |
| macd12x26x9-opposite-zero-cross | development-2018-2021 | 30 | 63 | 17 | 1.39% | 55.56% | 0.54% | 2.27% | -73.50% |
| macd12x26x9-opposite-zero-cross | development-2018-2021 | 60 | 62 | 17 | 0.34% | 53.23% | -5.53% | 6.61% | -66.71% |
| macd12x26x9-opposite-zero-cross | development-2018-2021 | 90 | 61 | 17 | -0.87% | 47.54% | -8.79% | 7.86% | -93.06% |
| macd12x26x9-opposite-zero-cross | historical-holdout-2022+ | 7 | 79 | 16 | -0.44% | 51.90% | -0.86% | -0.01% | -45.39% |
| macd12x26x9-opposite-zero-cross | historical-holdout-2022+ | 14 | 77 | 16 | 0.38% | 57.14% | 0.96% | -0.18% | -53.23% |
| macd12x26x9-opposite-zero-cross | historical-holdout-2022+ | 30 | 76 | 15 | 0.36% | 57.89% | 1.75% | -0.96% | -70.15% |
| macd12x26x9-opposite-zero-cross | historical-holdout-2022+ | 60 | 75 | 15 | -2.16% | 45.33% | -2.10% | -2.22% | -69.91% |
| macd12x26x9-opposite-zero-cross | historical-holdout-2022+ | 90 | 74 | 15 | -1.56% | 47.30% | -1.81% | -1.30% | -82.94% |

## Math and leakage proof

- RSI, bands, stochastic, and MACD at date `t` use only candles through the completed close at `t`.
- Entry is `open[t+1]`; exit is `open[t+h+1]`. Targets must mature inside their evaluation period.
- Primary effect: `D_j = mean_i[s_i * (r_i - mu_h) - 0.002]`.
- Uncertainty uses 5,000 circular moving-block samples at 30/60/90-day blocks and 50,000 joint within-year shifts.
- The within-year null preserves signal clustering and cross-indicator dependence better than a whole-history rotation, but it remains approximate under regime change.

## Research context

- [Gerritsen et al.](https://doi.org/10.1016/j.frl.2019.101263) supplies canonical BTC indicator definitions but limited OOS protection.
- [Deprez & Frömmel](https://doi.org/10.1016/j.iref.2024.05.003) shows technical-rule evidence is selection-sensitive even with costs and OOS testing.
- [Hudson & Urquhart](https://doi.org/10.1007/s10479-019-03357-1) finds no Bitcoin predictability in their pure OOS period.
- [John Bollinger’s rules](https://www.bollingerbands.com/bollinger-band-rules) explicitly warn that band tags are not standalone reversal signals.

## Reproduction

- Command: `npm run backtest:indicator-reversal`
- Git commit: `4cc9cb7aa4aed8ab42fe1af3ff9f1f736758a61a`
- Script SHA-256: `9528bfdb9e75395c1c1171af3b4ef42d9f990c949881c424eae534705e484ede`
- Indicator SHA-256: `281e14e5e6c7fd04a4d6bc22d10466b2673ab38e3d05016946a8642bfcce585d`
- No forecast, API, UI, regime, or product behavior changed.

