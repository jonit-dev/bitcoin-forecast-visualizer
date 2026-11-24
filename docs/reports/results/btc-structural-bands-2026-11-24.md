# BTC Structural Top & Bottom Bands Evaluation — 2026-11-24

- Generated: 2026-11-24T17:10:13.381Z
- Git commit: `55b56dec6dc87eb89dcb6e1bd8536392be06d44e`
- Dataset: `src/data/btc-history.json` (5971 rows, `2010-07-17` → `2026-11-20`, SHA-256 `daec4e3d67166af39e965611e252635aebdc41d6ab3f8cd0dafb4213bff447e1`)
- Status: **Report-only** (no production forecast or UI change)

## Gate Verdicts (Pre-Registered)

| Arm | Causal | Gate Verdict | Holdout Δ% | Boot180 Lo95 | Holm p | 22–24 Δ% | 25–26 Δ% | WF 17–26 Δ% | Cov | Inversions (2011–2045) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `B1_logt_qr` | yes | FAIL | -43.58% | -0.9595 | 1.0000 | -31.11% | -67.51% | -8.07% | 91.0% | 3342 |
| `B2_stretched_log_const` | yes | FAIL | -103.28% | -1.5180 | 1.0000 | -88.99% | -130.70% | -43.04% | 96.7% | 0 |
| `B3_stretched_log_decay` | yes | FAIL | -161.37% | -3.9743 | 1.0000 | -96.82% | -285.23% | -67.70% | 69.5% | 0 |
| `B4_logt_decay` | yes | FAIL | -161.37% | -3.9215 | 1.0000 | -96.82% | -285.23% | -60.33% | 69.5% | 0 |
| `B5_stretched_log_rvol` | yes | FAIL | -78.30% | -1.1741 | 1.0000 | -66.49% | -100.94% | -69.87% | 99.9% | 0 |
| `B6_shipped_base_anchored` | no (ablation) | FAIL | -39.02% | -0.5744 | n/a | -35.28% | -46.19% | -82.10% | 100.0% | 0 |

## Protocol 1 — Locked Out-of-Sample Holdout (2022-01-01 → 2026-11-20, α = 0.05 close)

Trained strictly on `2011-01-01 → 2021-12-31` (`n = 1785` holdout days).

| Arm | Winkler | Δ% vs B0 | Width (log) | Cov (95% target) | Below / Above | Pinball L | Pinball U | NW-DM t (Holm p) | Boot365 Lo95 |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |
| `B0_incumbent` | 1.3816 | — | 1.382 | 100.00% | 0 / 0 | 0.0171 | 0.0175 | — | — |
| `B1_logt_qr` | 1.9837 | -43.58% | 1.675 | 90.98% | 161 / 0 | 0.0191 | 0.0305 | -3.60 (1.0000) | -0.9009 |
| `B2_stretched_log_const` | 2.8084 | -103.28% | 2.772 | 96.69% | 59 / 0 | 0.0146 | 0.0556 | -25.13 (1.0000) | -1.5312 |
| `B3_stretched_log_decay` | 3.6110 | -161.37% | 1.713 | 69.47% | 545 / 0 | 0.0537 | 0.0366 | -2.68 (1.0000) | -4.0096 |
| `B4_logt_decay` | 3.6110 | -161.37% | 1.713 | 69.47% | 545 / 0 | 0.0537 | 0.0366 | -2.68 (1.0000) | -3.9658 |
| `B5_stretched_log_rvol` | 2.4633 | -78.30% | 2.463 | 99.94% | 1 / 0 | 0.0173 | 0.0443 | -20.29 (1.0000) | -1.1977 |
| `B6_shipped_base_anchored` | 1.9206 | -39.02% | 1.921 | 100.00% | 0 / 0 | 0.0297 | 0.0183 | -27.58 (1.0000) | -0.5843 |
| `B5_dynamic_lag1_diag` | 2.8563 | -106.74% | 1.750 | 82.58% | 311 / 0 | 0.0370 | 0.0344 | -1.96 (0.9751) | -3.3126 |

### Protocol 1 Secondary Targets & Sensitivities (Holdout 2022–2026)

| Arm | 98% Close Winkler (Δ%) | 98% Cov | OHLC 95% Winkler (Δ%) | OHLC Cov | Train 2013+ Winkler (Δ%) |
| --- | --- | ---: | --- | ---: | --- |
| `B0_incumbent` | 1.3816 (+0.00%) | 100.0% | 1.3816 (+0.00%) | 100.0% | 1.3816 (+0.00%) |
| `B1_logt_qr` | 1.9710 (-42.67%) | 99.9% | 2.0331 (-47.16%) | 90.6% | 7.3467 (-431.77%) |
| `B2_stretched_log_const` | 3.0654 (-121.88%) | 99.7% | 2.8265 (-104.59%) | 95.5% | 2.6226 (-89.83%) |
| `B3_stretched_log_decay` | 5.4140 (-291.87%) | 74.3% | 3.8005 (-175.09%) | 67.8% | 2.6226 (-89.83%) |
| `B4_logt_decay` | 5.4140 (-291.87%) | 74.3% | 3.8005 (-175.09%) | 67.8% | 2.6226 (-89.83%) |
| `B5_stretched_log_rvol` | 2.6611 (-92.62%) | 100.0% | 2.4636 (-78.32%) | 99.9% | 2.4884 (-80.11%) |
| `B6_shipped_base_anchored` | 2.5444 (-84.17%) | 100.0% | 1.9206 (-39.02%) | 100.0% | 1.5217 (-10.15%) |

- Diagnostic `B6_shipped_base_anchored` trained on `2015-01-01 → 2021-12-31`: Winkler = `1.5441` (-11.77% vs B0), width = `1.544`, coverage = `100.00%`.

## Protocol 2 — Expanding Causal 1-Year-Ahead Rolling Walk-Forward

Quarterly origins (`spacing = 90d`, `horizon = 365d`, `37` origins from `2017-01-01` to `2025-11-15`).

| Arm | 2017–2026 Winkler (Δ%) | Win Rate | Boot4Q Lo95 | 2017–2021 Δ% | 2022–2026 Δ% | Mean Cov |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `B0_incumbent` | 1.9759 (—) | 0% | — | — | — | 97.1% |
| `B1_logt_qr` | 2.1354 (-8.07%) | 35% | -0.3604 | +3.62% | -35.84% | 96.1% |
| `B2_stretched_log_const` | 2.8263 (-43.04%) | 0% | -1.1170 | -19.83% | -98.17% | 98.7% |
| `B3_stretched_log_decay` | 3.3136 (-67.70%) | 38% | -3.0350 | -65.52% | -72.88% | 87.4% |
| `B4_logt_decay` | 3.1680 (-60.33%) | 38% | -2.6068 | -51.25% | -81.89% | 86.8% |
| `B5_stretched_log_rvol` | 3.3565 (-69.87%) | 14% | -3.3978 | -82.64% | -39.57% | 92.1% |
| `B6_shipped_base_anchored` | 3.5980 (-82.10%) | 22% | -3.6469 | -111.00% | -13.47% | 86.5% |

## Structural Future Audit (2011-01-01 → 2045-12-31, Pre-2022 Locked Fits)

| Arm | Selected Params | Inversions | First Inversion | 2026-11-20 (Fl / Ctr / Pk) | 2035-01-01 (Fl / Ctr / Pk) | 2045-01-01 (Fl / Ctr / Pk) |
| --- | --- | ---: | --- | --- | --- | --- |
| `B0_incumbent` | `shipped` | 2165 | 2032-11-01 | $48,735 / $58,725 / $159,599 | $192,479 / $213,122 / $479,230 | $635,721 / $1,781,395 / $1,247,088 |
| `B1_logt_qr` | `slopeL=5.796, slopeU=4.712` | 3342 | 2036-11-07 | $77,618 / $201,456 / $351,888 | $679,333 / $1,882,321 / $2,052,412 | $4,482,907 / $13,148,260 / $9,515,401 |
| `B2_stretched_log_const` | `gamma=1.000, beta=0.000, zL=-0.956, zU=1.815` | 0 | none | $69,768 / $181,536 / $1,115,271 | $592,249 / $1,541,030 / $9,467,371 | $3,805,729 / $9,902,489 / $60,836,271 |
| `B3_stretched_log_decay` | `gamma=1.000, beta=0.500, zL=-0.790, zU=1.270` | 0 | none | $98,493 / $181,536 / $485,116 | $921,007 / $1,541,030 / $3,525,071 | $6,343,983 / $9,902,489 / $20,258,586 |
| `B4_logt_decay` | `gamma=1.000, beta=0.500, zL=-0.790, zU=1.270` | 0 | none | $98,493 / $181,536 / $485,116 | $921,007 / $1,541,030 / $3,525,071 | $6,343,983 / $9,902,489 / $20,258,586 |
| `B5_stretched_log_rvol` | `gamma=1.000, windowDays=730.000, zL=-26.169, zU=32.489` | 0 | none | $60,507 / $181,536 / $710,157 | $513,639 / $1,541,030 / $6,028,415 | $3,300,586 / $9,902,489 / $38,737,922 |
| `B6_shipped_base_anchored` | `beta=0.750, zL=-1.672, zU=0.879` | 0 | none | $30,685 / $95,127 / $172,423 | $155,494 / $375,701 / $597,359 | $602,995 / $1,240,869 / $1,813,311 |

## Cycle-Extremes Diagnostic (Pre-2022 Locked Fits)

| Event | Actual Extreme | B0 Band (Fl / Pk) | B0 Ratio | B3 Band (Fl / Pk) | B3 Ratio | B4 Band (Fl / Pk) | B4 Ratio |
| --- | ---: | --- | ---: | --- | ---: | --- | ---: |
| 2013 Peak (2013-11-29) | $1,242 | $35.27 / $3,568 | 0.35x | $35.79 / $697.34 | 1.78x | $35.79 / $697.34 | 1.78x |
| 2015 Low (2015-01-14) | $157.29 | $118.05 / $6,547 | 1.33x | $130.02 / $1,904 | 1.21x | $130.02 / $1,904 | 1.21x |
| 2017 Peak (2017-12-17) | $19,871 | $1,192 / $20,921 | 0.95x | $1,491 / $13,663 | 1.45x | $1,491 / $13,663 | 1.45x |
| 2018 Low (2018-12-15) | $3,170 | $2,205 / $28,504 | 1.44x | $2,838 / $23,307 | 1.12x | $2,838 / $23,307 | 1.12x |
| 2021 Peak (2021-11-10) | $68,979 | $9,865 / $60,509 | 1.14x | $13,470 / $86,773 | 0.80x | $13,470 / $86,773 | 0.80x |
| 2022 Low (2022-11-21) | $15,481 | $15,480 / $75,882 | 1.00x | $21,467 / $129,336 | 0.72x | $21,467 / $129,336 | 0.72x |
| 2025 Peak (2025-10-06) | $125,894 | $38,414 / $131,915 | 0.95x | $66,726 / $345,184 | 0.36x | $66,726 / $345,184 | 0.36x |
| 2026 Low (2026-06-25) | $58,244 | $44,802 / $149,203 | 1.30x | $85,832 / $430,073 | 0.68x | $85,832 / $430,073 | 0.68x |

## Limitations & Methodological Caveats

- **Low-frequency effective sample size:** BTC exhibits ~4-year halving/liquidity cycles, so the `2022-01-01 → 2026-11-20` holdout (~4.9 years) contains only ~1.2 independent macro cycles (`~1` cycle trough in Nov 2022 and `~1` cycle peak in Oct 2025). Daily block-bootstrap (`B=180/365`) and HAC-DM tests quantify autocorrelation at sub-annual scales, not multi-year cycle independence.
- **Incumbent lookback asymmetry:** `B0_incumbent` uses fixed historical coefficients (`POWER_LAW_CONFIG`) tuned using post-2021 awareness, whereas `B1..B5` are fitted strictly on pre-2022 data (`<= 2021-12-31`).
- **Vintage caveat:** `src/data/btc-history.json` is latest-revised OHLCV rather than point-in-time archival snapshots.
