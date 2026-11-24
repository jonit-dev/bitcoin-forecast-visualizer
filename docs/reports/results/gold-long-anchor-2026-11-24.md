# Gold Long-Horizon Valuation Anchor Study (2026-11-24)

Report-only causal out-of-sample benchmark comparing long-horizon valuation anchors for Gold (`USD/oz`) against the current `1Y momentum -> +4%/yr` baseline (`G0_incumbent`). **No production forecast formulas were altered by this research artifact.**

## Verdict Summary

- **Pre-registered promotion gate:** PASSED by `G4a_m2_ratio_mr` (report-only; pending human review before any production change).
- **Lowest 120m (10Y) holdout MALE:** `G4a_m2_ratio_mr` (0.2132 vs `G0_incumbent` 0.3693, delta -0.1560, Holm bootstrap p=0.0012).
- **Post-1971 Power Law (`G1_power_law_1971`) at 120m:** MALE 0.5029 (delta +0.1337 vs `G0`, 95% block-boot CI [+0.0247, +0.2434], Holm boot p=1.0000).

## Dataset & Protocol

- **Monthly dataset:** `src/data/gold-long-horizon-monthly.json` (`682` rows, `1970-01` -> `2026-10`, all 4 series populated through `2026-09`, missing CPI: `2025-10`; SHA-256 `aad0a6af5f8f...`, git commit `55b56de`).
- **Sources:** Spot gold monthly (`datahub.io/core/gold-prices`), FRED `CPIAUCSL`, `M2SL`, and `GS10`.
- **Caveats:** Macro series reflect latest-revised FRED vintages rather than point-in-time ALFRED releases; every macro arm enforces `macroLagMonths >= 1` (with `macroLagMonths = 2` sensitivity check) and missing macro observations (such as FRED `CPIAUCSL 2025-10`) resolve strictly causally backward (`<= origin - macroLagMonths`).
- **Dev/Holdout split:** Expanding fits anchored at `1972-01`. Hyperparameters selected strictly on purged pre-2004 dev windows (origins `>= 1975-01`, matured target `<= 2003-12`). Primary out-of-sample evaluation uses origins `>= 2004-01` through matured targets `<= 2026-10`.
- **Inference:** Block bootstrap uses circular moving blocks of length `h` months (5000 deterministic draws, seed `20261124`) on paired loss improvement (`|e_G0| - |e_arm|`, reported back as `deltaMALE = MALE_arm - MALE_G0`, so negative delta and CI upper bound `< 0` favor the challenger). Holm-Bonferroni correction spans the 6 challengers per horizon. Newey-West HAC DM tests use lag `h - 1`.

## Arms Under Test

- **`G0_incumbent`**: Current production gold rule (1Y capped momentum -> +4%/yr long drift)
- **`G1_power_law_1971`**: Causal log-log power law anchored at 1971-08-15 (+ dev-selected mean reversion)
- **`G2_exponential_mr`**: Causal log-linear exponential trend since 1972-01 (+ dev-selected MR)
- **`G3_erb_harvey_cpi_mr`**: Erb & Harvey causal Gold/CPI real-price mean reversion + CPI drift
- **`G4a_m2_ratio_mr`**: Causal Gold/M2 ratio mean reversion + causal M2 growth drift
- **`G4b_m2_cpi_coint`**: Causal 2-factor M2 + CPI cointegration ridge regression + residual MR
- **`G5_real_rate_cpi_drift`**: 1Y momentum then causal 5Y CPI + real-10Y rate (GS10 - YoY CPI) ridge drift

## Primary Post-2004 Holdout Results (Lag = 1 Month)

Negative `deltaMALE` means lower absolute log error than `G0_incumbent`. `95% Boot CI` and `Holm Boot p` test one-sided H1 (`MALE_arm < MALE_G0`) across the 6 challengers per horizon.

### Horizon 12m (1Y) — n=262 origins (2004-01..2025-10, targets 2005-01..2026-10)

| Arm | Dev Params | Dev MALE | Holdout MALE | RMSLE | Bias | Hit Rate | deltaMALE vs G0 | 95% Boot CI (delta) | Boot p (1s) | Holm Boot p | NW DM t | Holm NW p |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| `G0_incumbent` | `-` | 0.1726 | 0.1367 | 0.1647 | -0.0398 | 69.5% | 0.0000 | - | n/a | n/a | n/a | n/a |
| `G1_power_law_1971` | `tau=inf` | 0.1646 | 0.1497 | 0.1889 | -0.0955 | 71.4% | +0.0129 | [-0.0153, +0.0413] | 0.8160 | 1.0000 | -0.91 | 1.0000 |
| `G2_exponential_mr` | `tau=inf` | 0.1928 | 0.1429 | 0.1781 | -0.0686 | 71.4% | +0.0061 | [-0.0184, +0.0305] | 0.6849 | 1.0000 | -0.49 | 1.0000 |
| `G3_erb_harvey_cpi_mr` | `lambda=0.25, tau=120` | 0.1687 | 0.1418 | 0.1800 | -0.0802 | 71.4% | +0.0051 | [-0.0212, +0.0316] | 0.6549 | 1.0000 | -0.38 | 1.0000 |
| `G4a_m2_ratio_mr` | `lambda=0.25, tau=120` | 0.1726 | 0.1349 | 0.1672 | -0.0413 | 71.4% | -0.0018 | [-0.0244, +0.0216] | 0.4443 | 1.0000 | +0.16 | 1.0000 |
| `G4b_m2_cpi_coint` | `tau=inf` | 0.1950 | 0.1428 | 0.1775 | -0.0643 | 71.4% | +0.0061 | [-0.0183, +0.0303] | 0.6879 | 1.0000 | -0.49 | 1.0000 |
| `G5_real_rate_cpi_drift` | `ridge=1` | 0.1726 | 0.1367 | 0.1647 | -0.0398 | 69.5% | +0.0000 | [+0.0000, +0.0000] | 1.0000 | 1.0000 | +0.00 | 1.0000 |

### Horizon 24m (2Y) — n=250 origins (2004-01..2024-10, targets 2006-01..2026-10)

| Arm | Dev Params | Dev MALE | Holdout MALE | RMSLE | Bias | Hit Rate | deltaMALE vs G0 | 95% Boot CI (delta) | Boot p (1s) | Holm Boot p | NW DM t | Holm NW p |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| `G0_incumbent` | `-` | 0.2587 | 0.2198 | 0.2794 | -0.1063 | 78.0% | 0.0000 | - | n/a | n/a | n/a | n/a |
| `G1_power_law_1971` | `tau=inf` | 0.2490 | 0.2635 | 0.3170 | -0.1814 | 79.6% | +0.0437 | [+0.0009, +0.0850] | 0.9832 | 1.0000 | -2.04 | 1.0000 |
| `G2_exponential_mr` | `tau=inf` | 0.3263 | 0.2435 | 0.2934 | -0.1280 | 79.6% | +0.0237 | [-0.0108, +0.0588] | 0.8958 | 1.0000 | -1.29 | 1.0000 |
| `G3_erb_harvey_cpi_mr` | `lambda=0.25, tau=60` | 0.2648 | 0.2453 | 0.2983 | -0.1665 | 79.6% | +0.0255 | [-0.0104, +0.0590] | 0.9300 | 1.0000 | -1.41 | 1.0000 |
| `G4a_m2_ratio_mr` | `lambda=0.25, tau=120` | 0.2792 | 0.2190 | 0.2641 | -0.0721 | 79.6% | -0.0008 | [-0.0290, +0.0317] | 0.5039 | 1.0000 | +0.05 | 1.0000 |
| `G4b_m2_cpi_coint` | `tau=inf` | 0.3310 | 0.2430 | 0.2919 | -0.1193 | 79.6% | +0.0232 | [-0.0105, +0.0583] | 0.8930 | 1.0000 | -1.28 | 1.0000 |
| `G5_real_rate_cpi_drift` | `ridge=100` | 0.2638 | 0.2228 | 0.2799 | -0.1077 | 75.2% | +0.0030 | [-0.0050, +0.0113] | 0.7443 | 1.0000 | -0.68 | 1.0000 |

### Horizon 60m (5Y) — n=214 origins (2004-01..2021-10, targets 2009-01..2026-10)

| Arm | Dev Params | Dev MALE | Holdout MALE | RMSLE | Bias | Hit Rate | deltaMALE vs G0 | 95% Boot CI (delta) | Boot p (1s) | Holm Boot p | NW DM t | Holm NW p |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| `G0_incumbent` | `-` | 0.3968 | 0.3847 | 0.4462 | -0.1929 | 78.0% | 0.0000 | - | n/a | n/a | n/a | n/a |
| `G1_power_law_1971` | `tau=inf` | 0.3632 | 0.4582 | 0.5385 | -0.3501 | 78.5% | +0.0735 | [-0.0520, +0.1807] | 0.8910 | 1.0000 | -1.25 | 1.0000 |
| `G2_exponential_mr` | `tau=inf` | 0.6136 | 0.4005 | 0.4767 | -0.2201 | 78.5% | +0.0158 | [-0.0390, +0.0798] | 0.6965 | 1.0000 | -0.50 | 1.0000 |
| `G3_erb_harvey_cpi_mr` | `lambda=0.25, tau=120` | 0.4698 | 0.3961 | 0.4580 | -0.2509 | 78.5% | +0.0114 | [-0.0503, +0.0633] | 0.6275 | 1.0000 | -0.38 | 1.0000 |
| `G4a_m2_ratio_mr` | `lambda=0.25, tau=120` | 0.5257 | 0.3271 | 0.3917 | -0.0774 | 78.5% | -0.0576 | [-0.1202, +0.0139] | 0.0426 | 0.2555 | +1.69 | 0.2753 |
| `G4b_m2_cpi_coint` | `tau=inf` | 0.5983 | 0.3942 | 0.4717 | -0.1990 | 78.5% | +0.0095 | [-0.0465, +0.0702] | 0.6307 | 1.0000 | -0.30 | 1.0000 |
| `G5_real_rate_cpi_drift` | `ridge=100` | 0.4879 | 0.3962 | 0.4679 | -0.1603 | 78.5% | +0.0115 | [-0.0185, +0.0472] | 0.7506 | 1.0000 | -0.61 | 1.0000 |

### Horizon 120m (10Y) — n=154 origins (2004-01..2016-10, targets 2014-01..2026-10)

| Arm | Dev Params | Dev MALE | Holdout MALE | RMSLE | Bias | Hit Rate | deltaMALE vs G0 | 95% Boot CI (delta) | Boot p (1s) | Holm Boot p | NW DM t | Holm NW p |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| `G0_incumbent` | `-` | 0.5112 | 0.3693 | 0.4614 | -0.1869 | 98.7% | 0.0000 | - | n/a | n/a | n/a | n/a |
| `G1_power_law_1971` | `tau=inf` | 0.5005 | 0.5029 | 0.6197 | -0.4884 | 98.7% | +0.1337 | [+0.0247, +0.2434] | 1.0000 | 1.0000 | -1.51 | 1.0000 |
| `G2_exponential_mr` | `tau=inf` | 1.5406 | 0.3607 | 0.4636 | -0.2466 | 98.7% | -0.0086 | [-0.0707, +0.0542] | 0.3749 | 1.0000 | +0.15 | 1.0000 |
| `G3_erb_harvey_cpi_mr` | `lambda=1, tau=36` | 0.6261 | 0.5875 | 0.6634 | -0.5875 | 44.2% | +0.2182 | [+0.1326, +0.3056] | 1.0000 | 1.0000 | -2.63 | 1.0000 |
| `G4a_m2_ratio_mr` | `lambda=1, tau=36` | 0.7977 | 0.2132 | 0.2421 | +0.1141 | 98.7% | -0.1560 | [-0.2897, -0.0263] | 0.0002 | 0.0012 | +1.73 | 0.2506 |
| `G4b_m2_cpi_coint` | `tau=inf` | 1.3549 | 0.3549 | 0.4546 | -0.2100 | 98.7% | -0.0144 | [-0.0766, +0.0472] | 0.3225 | 1.0000 | +0.25 | 1.0000 |
| `G5_real_rate_cpi_drift` | `ridge=100` | 0.8091 | 0.4664 | 0.5795 | -0.3782 | 98.7% | +0.0971 | [+0.0247, +0.1707] | 1.0000 | 1.0000 | -1.55 | 1.0000 |

## Pre-Registered Promotion Gate Evaluation

Gate requires ALL of: `120m deltaMALE <= -0.05`, `120m Boot CI upper < 0`, `120m Holm Boot p < 0.05`, `60m deltaMALE <= +0.03`, and preservation under `macroLagMonths = 2`.

| Challenger | 120m deltaMALE | 120m Boot CI High | 120m Holm Boot p | 60m deltaMALE | Lag=2 120m deltaMALE | Lag=2 Holm p | Gate Verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| `G1_power_law_1971` | +0.1337 | +0.2434 | 1.0000 | +0.0735 | +0.1337 | 1.0000 | **FAIL** |
| `G2_exponential_mr` | -0.0086 | +0.0542 | 1.0000 | +0.0158 | -0.0086 | 1.0000 | **FAIL** |
| `G3_erb_harvey_cpi_mr` | +0.2182 | +0.3056 | 1.0000 | +0.0114 | +0.2162 | 1.0000 | **FAIL** |
| `G4a_m2_ratio_mr` | -0.1560 | -0.0263 | 0.0012 | -0.0576 | -0.1551 | 0.0012 | **PASS** |
| `G4b_m2_cpi_coint` | -0.0144 | +0.0472 | 1.0000 | +0.0095 | -0.0136 | 1.0000 | **FAIL** |
| `G5_real_rate_cpi_drift` | +0.0971 | +0.1707 | 1.0000 | +0.0115 | +0.0967 | 1.0000 | **FAIL** |

## Holdout Sub-Period Breakdown (60m and 120m MALE)

### 60m (5Y) Sub-Periods

| Sub-Period | Origins (n) | `G0_incumbent` | `G1_power_law_1971` | `G2_exponential_mr` | `G3_erb_harvey_cpi_mr` | `G4a_m2_ratio_mr` | `G4b_m2_cpi_coint` | `G5_real_rate_cpi_drift` |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2004-01..2009-12 | 2004-01..2009-12 (72) | 0.4894 | 0.6811 (+0.192) | 0.5990 (+0.110) | 0.5325 (+0.043) | 0.4096 (-0.080) | 0.5907 (+0.101) | 0.5066 (+0.017) |
| 2010-01..2015-12 | 2010-01..2015-12 (72) | 0.3374 | 0.2292 (-0.108) | 0.2970 (-0.040) | 0.2597 (-0.078) | 0.3688 (+0.031) | 0.3138 (-0.024) | 0.3924 (+0.055) |
| 2016-01..maxMatured | 2016-01..2021-10 (70) | 0.3256 | 0.4645 (+0.139) | 0.3028 (-0.023) | 0.3960 (+0.070) | 0.1994 (-0.126) | 0.2747 (-0.051) | 0.2865 (-0.039) |

### 120m (10Y) Sub-Periods

| Sub-Period | Origins (n) | `G0_incumbent` | `G1_power_law_1971` | `G2_exponential_mr` | `G3_erb_harvey_cpi_mr` | `G4a_m2_ratio_mr` | `G4b_m2_cpi_coint` | `G5_real_rate_cpi_drift` |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2004-01..2009-12 | 2004-01..2009-12 (72) | 0.2984 | 0.5760 (+0.278) | 0.3976 (+0.099) | 0.3672 (+0.069) | 0.2250 (-0.073) | 0.3844 (+0.086) | 0.4948 (+0.196) |
| 2010-01..2015-12 | 2010-01..2015-12 (72) | 0.3664 | 0.3409 (-0.025) | 0.2599 (-0.106) | 0.6966 (+0.330) | 0.1668 (-0.200) | 0.2686 (-0.098) | 0.3647 (-0.002) |
| 2016-01..maxMatured | 2016-01..2016-10 (10) | 0.9001 | 1.1433 (+0.243) | 0.8205 (-0.080) | 1.3879 (+0.488) | 0.4628 (-0.437) | 0.7635 (-0.137) | 0.9935 (+0.093) |

## Macro Publication-Lag Sensitivity (Lag = 2 Months vs Lag = 1 Month, Locked Dev Params)

| Arm | Horizon | n | Lag=1 MALE | Lag=2 MALE | Lag=1 delta | Lag=2 delta | Lag=2 95% Boot CI | Lag=2 Holm Boot p | Same Negative Sign |
|---|---:|---:|---:|---:|---:|---:|---|---:|---|
| `G3_erb_harvey_cpi_mr` | 60m | 214 | 0.3961 | 0.3960 | +0.0114 | +0.0113 | [-0.0503, +0.0632] | 1.0000 | no |
| `G4a_m2_ratio_mr` | 60m | 214 | 0.3271 | 0.3272 | -0.0576 | -0.0575 | [-0.1202, +0.0142] | 0.2627 | yes |
| `G4b_m2_cpi_coint` | 60m | 214 | 0.3942 | 0.3946 | +0.0095 | +0.0099 | [-0.0465, +0.0715] | 1.0000 | no |
| `G5_real_rate_cpi_drift` | 60m | 214 | 0.3962 | 0.3952 | +0.0115 | +0.0105 | [-0.0185, +0.0452] | 1.0000 | no |
| `G3_erb_harvey_cpi_mr` | 120m | 154 | 0.5875 | 0.5854 | +0.2182 | +0.2162 | [+0.1310, +0.3031] | 1.0000 | no |
| `G4a_m2_ratio_mr` | 120m | 154 | 0.2132 | 0.2142 | -0.1560 | -0.1551 | [-0.2890, -0.0250] | 0.0012 | yes |
| `G4b_m2_cpi_coint` | 120m | 154 | 0.3549 | 0.3557 | -0.0144 | -0.0136 | [-0.0767, +0.0489] | 1.0000 | yes |
| `G5_real_rate_cpi_drift` | 120m | 154 | 0.4664 | 0.4659 | +0.0971 | +0.0967 | [+0.0219, +0.1729] | 1.0000 | no |

## Live Forward Projection From 2026-10 (Spot Gold $4,105.00/oz)

Lagged macro anchor at origin `2026-10` uses `2026-09` (`CPI=336.298`, `M2=23413.9`, `GS10=4.99%`).

### Target 2027-10 (12m / 1Y)

| Arm | Selected Dev Params | Pred Log Return | Cumulative Change | Annualized CAGR | Implied Spot Gold |
|---|---|---:|---:|---:|---:|
| `G0_incumbent` | `-` | +0.0807 | +8.4% | +8.40% | $4,449.98 |
| `G1_power_law_1971` | `tau=inf` | +0.0148 | +1.5% | +1.49% | $4,166.30 |
| `G2_exponential_mr` | `tau=inf` | +0.0512 | +5.3% | +5.25% | $4,320.56 |
| `G3_erb_harvey_cpi_mr` | `lambda=0.25, tau=120` | +0.0093 | +0.9% | +0.93% | $4,143.22 |
| `G4a_m2_ratio_mr` | `lambda=0.25, tau=120` | +0.0537 | +5.5% | +5.51% | $4,331.27 |
| `G4b_m2_cpi_coint` | `tau=inf` | +0.0532 | +5.5% | +5.47% | $4,329.45 |
| `G5_real_rate_cpi_drift` | `ridge=1` | +0.0807 | +8.4% | +8.40% | $4,449.98 |

### Target 2028-10 (24m / 2Y)

| Arm | Selected Dev Params | Pred Log Return | Cumulative Change | Annualized CAGR | Implied Spot Gold |
|---|---|---:|---:|---:|---:|
| `G0_incumbent` | `-` | +0.1200 | +12.8% | +6.18% | $4,628.48 |
| `G1_power_law_1971` | `tau=inf` | +0.0294 | +3.0% | +1.48% | $4,227.58 |
| `G2_exponential_mr` | `tau=inf` | +0.1024 | +10.8% | +5.25% | $4,547.44 |
| `G3_erb_harvey_cpi_mr` | `lambda=0.25, tau=60` | -0.0241 | -2.4% | -1.20% | $4,007.18 |
| `G4a_m2_ratio_mr` | `lambda=0.25, tau=120` | +0.1083 | +11.4% | +5.56% | $4,574.44 |
| `G4b_m2_cpi_coint` | `tau=inf` | +0.1065 | +11.2% | +5.47% | $4,566.18 |
| `G5_real_rate_cpi_drift` | `ridge=100` | +0.1763 | +19.3% | +9.22% | $4,896.54 |

### Target 2031-10 (60m / 5Y)

| Arm | Selected Dev Params | Pred Log Return | Cumulative Change | Annualized CAGR | Implied Spot Gold |
|---|---|---:|---:|---:|---:|
| `G0_incumbent` | `-` | +0.2377 | +26.8% | +4.87% | $5,206.41 |
| `G1_power_law_1971` | `tau=inf` | +0.0716 | +7.4% | +1.44% | $4,409.82 |
| `G2_exponential_mr` | `tau=inf` | +0.2559 | +29.2% | +5.25% | $5,302.09 |
| `G3_erb_harvey_cpi_mr` | `lambda=0.25, tau=120` | +0.0715 | +7.4% | +1.44% | $4,409.41 |
| `G4a_m2_ratio_mr` | `lambda=0.25, tau=120` | +0.2771 | +31.9% | +5.70% | $5,415.65 |
| `G4b_m2_cpi_coint` | `tau=inf` | +0.2662 | +30.5% | +5.47% | $5,356.89 |
| `G5_real_rate_cpi_drift` | `ridge=100` | +0.3793 | +46.1% | +7.88% | $5,998.25 |

### Target 2036-10 (120m / 10Y)

| Arm | Selected Dev Params | Pred Log Return | Cumulative Change | Annualized CAGR | Implied Spot Gold |
|---|---|---:|---:|---:|---:|
| `G0_incumbent` | `-` | +0.4340 | +54.3% | +4.44% | $6,335.75 |
| `G1_power_law_1971` | `tau=inf` | +0.1376 | +14.7% | +1.39% | $4,710.42 |
| `G2_exponential_mr` | `tau=inf` | +0.5118 | +66.8% | +5.25% | $6,848.26 |
| `G3_erb_harvey_cpi_mr` | `lambda=1, tau=36` | -0.7967 | -54.9% | -7.66% | $1,850.67 |
| `G4a_m2_ratio_mr` | `lambda=1, tau=36` | +0.2254 | +25.3% | +2.28% | $5,143.07 |
| `G4b_m2_cpi_coint` | `tau=inf` | +0.5324 | +70.3% | +5.47% | $6,990.57 |
| `G5_real_rate_cpi_drift` | `ridge=100` | +0.5935 | +81.0% | +6.12% | $7,431.70 |

