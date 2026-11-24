# Gold Long-Horizon `Gold/M2` Anchor Production Gate (2026-11-24)

- **Gate Verdict:** **PASS**
- **Frozen Specification:** For `day <= 365`, production Gold forecast is unchanged (`momentum` / `gold365V2`). For `day > 365`, log median return adds `-0.25 * gap * (1 - exp(-(day - 365) / 3652.5))` on top of the `+4%/yr` long-run drift, where `gap = ln(spotGoldNow / M2_lagged) - expandingMean(ln(Gold / M2_lag1))`.
- **Pre-2004 Dev Selection (pooled over 24m/60m/120m):** `lambda=0.25, tau=120m` ranked #1 (devRatio `0.9999` vs `G0`).
- **Live GLD Snapshot (`2026-11-20`, GLD `$322.87`):** `M2=2026-09`, `gap=0.3312` (`1.39x` vs expanding historical mean), `amplitude=0.0828`.

## Monthly 2004-2026 Out-of-Sample Holdout (Lag = 1m and Lag = 2m Sensitivity)

| Horizon | n | G0 MALE | Anchor MALE (lag=1) | delta (lag=1) | 95% Boot CI (lag=1) | Boot p (1s) | NW DM t | Lag=2 delta | Lag=2 Boot p | Lag=2 NW t |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| 24m (2Y) | 250 | 0.2198 | 0.2158 | -0.0040 | [-0.0061, -0.0021] | 0.0002 | +3.65 | -0.0040 | 0.0002 | +3.70 |
| 60m (5Y) | 214 | 0.3847 | 0.3655 | -0.0192 | [-0.0257, -0.0142] | 0.0002 | +6.06 | -0.0191 | 0.0002 | +6.00 |
| 120m (10Y) | 154 | 0.3693 | 0.3347 | -0.0346 | [-0.0460, -0.0229] | 0.0002 | +4.00 | -0.0346 | 0.0002 | +3.99 |

## Daily GLD Walk-Forward Gate (2009-2026 Origins, Step 10 Sessions)

| Horizon | n | G0 MAE | Anchor MAE | MAE Gain | G0 Pinball | Anchor Pinball | Pinball Gain | NW Pinball t | Cov90 | Cov80 | Brier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| 730d (2Y) | 404 | 0.2223 | 0.2198 | +1.1% | 0.05530 | 0.05452 | +1.4% | +2.67 | 82.7% -> 83.9% | 69.6% -> 70.5% | 0.220 -> 0.215 |
| 1825d (5Y) | 329 | 0.3119 | 0.2957 | +5.2% | 0.07016 | 0.06740 | +3.9% | +4.15 | 94.2% -> 95.4% | 83.0% -> 85.4% | 0.226 -> 0.214 |
| 3650d (10Y) | 203 | 0.3878 | 0.3625 | +6.5% | 0.09297 | 0.08933 | +3.9% | +3.53 | 94.6% -> 95.6% | 86.7% -> 87.7% | 0.097 -> 0.096 |

## Monthly 1975-2026 Sub-Period Breakdown

### 60m (5Y)

| Origin Period | n | G0 MALE | Anchor MALE | deltaMALE |
|---|---:|---:|---:|---:|
| 1975-01..1984-12 | 120 | 0.5612 | 0.5482 | -0.0129 |
| 1985-01..1994-12 | 120 | 0.2595 | 0.2757 | +0.0162 |
| 1995-01..2003-12 | 108 | 0.4179 | 0.3857 | -0.0322 |
| 2004-01..2009-12 | 72 | 0.4894 | 0.4665 | -0.0229 |
| 2010-01..2015-12 | 72 | 0.3374 | 0.3195 | -0.0179 |
| 2016-01..2026-10 | 70 | 0.3256 | 0.3090 | -0.0166 |

### 120m (10Y)

| Origin Period | n | G0 MALE | Anchor MALE | deltaMALE |
|---|---:|---:|---:|---:|
| 1975-01..1984-12 | 120 | 0.5091 | 0.4771 | -0.0320 |
| 1985-01..1994-12 | 120 | 0.4956 | 0.5312 | +0.0357 |
| 1995-01..2003-12 | 108 | 0.8084 | 0.7252 | -0.0832 |
| 2004-01..2009-12 | 72 | 0.2984 | 0.2588 | -0.0396 |
| 2010-01..2015-12 | 72 | 0.3664 | 0.3355 | -0.0309 |
| 2016-01..2026-10 | 10 | 0.9001 | 0.8754 | -0.0247 |

