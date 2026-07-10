# Point-In-Time calibrated-jagged-path Benchmark

Status: report-only; no runtime forecast changes.

## Provenance

- Generated: 2026-07-10T19:54:36.041Z
- Git commit: `28d5c863aaa389e2b8fae6ebaba95b98c392da1e`
- Seed: 1498152960
- Data SHA-256: `23b947fb572a724e75314608e57d56203b734f0cd134a389a30c9d264fab4919`
- Data: 2010-07-17 through 2026-07-09 (5837 rows)
- Close availability: UTC daily close is available after that date closes; structural fit includes the origin close; calibration targets must be strictly earlier than origin.
- Origin rows: 35; skips: 1

## Candidate evaluation

- Candidate: calibrated-jagged-path
- Verdict: **path-diagnostics-only; q50 unchanged; terminal calibration not promotion-ready** (research-only)
- Previously inspected periods are robustness-only.

| h | n | Baseline MALE | Candidate MALE | Relative improvement | Bootstrap 95% | Holm p | Direction |
|---:|---:|---:|---:|---:|---|---:|---:|
| 14 | 9 | 0.077898 | 0.077898 | 0.00% | [0.000000, 0.000000] | 1.0000 | 55.6% |
| 30 | 9 | 0.171276 | 0.171276 | 0.00% | [0.000000, 0.000000] | 1.0000 | 55.6% |
| 60 | 9 | 0.262150 | 0.262150 | 0.00% | [0.000000, 0.000000] | 1.0000 | 33.3% |
| 90 | 8 | 0.223091 | 0.223091 | 0.00% | [0.000000, 0.000000] | 1.0000 | 37.5% |

## Benchmark comparison

| Horizon | Model | Samples | MALE |
|---:|---|---:|---:|
| 14 | reconstructed-current-policy | 9 | 0.077898 |
| 14 | naive-current-price | 9 | 0.077498 |
| 14 | gbm-driftless | 9 | 0.077498 |
| 14 | gbm-recent-drift | 9 | 0.071203 |
| 14 | ma-trend-20-50-200 | 9 | 0.067621 |
| 30 | reconstructed-current-policy | 9 | 0.171276 |
| 30 | naive-current-price | 9 | 0.155527 |
| 30 | gbm-driftless | 9 | 0.155527 |
| 30 | gbm-recent-drift | 9 | 0.159965 |
| 30 | ma-trend-20-50-200 | 9 | 0.137335 |
| 60 | reconstructed-current-policy | 9 | 0.262150 |
| 60 | naive-current-price | 9 | 0.190608 |
| 60 | gbm-driftless | 9 | 0.190608 |
| 60 | gbm-recent-drift | 9 | 0.195214 |
| 60 | ma-trend-20-50-200 | 9 | 0.146108 |
| 90 | reconstructed-current-policy | 8 | 0.223091 |
| 90 | naive-current-price | 8 | 0.208594 |
| 90 | gbm-driftless | 8 | 0.208594 |
| 90 | gbm-recent-drift | 8 | 0.263742 |
| 90 | ma-trend-20-50-200 | 8 | 0.133402 |

## Per-origin provenance sample

| Origin | Target | h | Train start | Train end | Last known target | Coefficients | Interval snapshot | Data hash | Seed | Benchmarks |
|---|---|---:|---|---|---|---|---|---|---:|---|
| 2022-05-15 | 2022-05-29 | 14 | 2010-07-17 | 2022-05-15 | none | c=1.3677e-17, e=5.80682 | n=0, q90=n/a | `61c64aa466b7` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-05-15 | 2022-06-14 | 30 | 2010-07-17 | 2022-05-15 | none | c=1.3677e-17, e=5.80682 | n=0, q90=n/a | `61c64aa466b7` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-05-15 | 2022-07-14 | 60 | 2010-07-17 | 2022-05-15 | none | c=1.3677e-17, e=5.80682 | n=0, q90=n/a | `61c64aa466b7` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-05-15 | 2022-08-13 | 90 | 2010-07-17 | 2022-05-15 | none | c=1.3677e-17, e=5.80682 | n=0, q90=n/a | `61c64aa466b7` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-11-11 | 2022-11-25 | 14 | 2010-07-17 | 2022-11-11 | 2022-05-29 | c=2.8589e-17, e=5.70735 | n=1, q90=0.10521 | `4682c1b8af1d` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-11-11 | 2022-12-11 | 30 | 2010-07-17 | 2022-11-11 | 2022-06-14 | c=2.8589e-17, e=5.70735 | n=1, q90=0.43766 | `4682c1b8af1d` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-11-11 | 2023-01-10 | 60 | 2010-07-17 | 2022-11-11 | 2022-07-14 | c=2.8589e-17, e=5.70735 | n=1, q90=0.58334 | `4682c1b8af1d` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-11-11 | 2023-02-09 | 90 | 2010-07-17 | 2022-11-11 | 2022-08-13 | c=2.8589e-17, e=5.70735 | n=1, q90=0.46859 | `4682c1b8af1d` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2023-05-10 | 2023-05-24 | 14 | 2010-07-17 | 2023-05-10 | 2022-11-25 | c=4.4677e-17, e=5.64763 | n=2, q90=0.07962 | `34b17fe7f247` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2023-05-10 | 2023-06-09 | 30 | 2010-07-17 | 2023-05-10 | 2022-12-11 | c=4.4677e-17, e=5.64763 | n=2, q90=0.09492 | `34b17fe7f247` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2023-05-10 | 2023-07-09 | 60 | 2010-07-17 | 2023-05-10 | 2023-01-10 | c=4.4677e-17, e=5.64763 | n=2, q90=0.15103 | `34b17fe7f247` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2023-05-10 | 2023-08-08 | 90 | 2010-07-17 | 2023-05-10 | 2023-02-09 | c=4.4677e-17, e=5.64763 | n=2, q90=0.01722 | `34b17fe7f247` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |

The JSON artifact contains nested-selection metadata, robustness, sensitivity, provenance, skip reasons, and all rows. Differences from legacy backtests are methodology findings.
