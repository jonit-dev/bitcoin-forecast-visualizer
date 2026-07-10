# Point-In-Time state-space-residual Benchmark

Status: report-only; no runtime forecast changes.

## Provenance

- Generated: 2026-07-10T20:03:02.116Z
- Git commit: `28d5c863aaa389e2b8fae6ebaba95b98c392da1e`
- Seed: 1498152960
- Data SHA-256: `23b947fb572a724e75314608e57d56203b734f0cd134a389a30c9d264fab4919`
- Data: 2010-07-17 through 2026-07-09 (5837 rows)
- Close availability: UTC daily close is available after that date closes; structural fit includes the origin close; calibration targets must be strictly earlier than origin.
- Origin rows: 16; skips: 0

## Candidate evaluation

- Candidate: state-space-residual
- Verdict: **rejected-development-gate** (research-only)
- Previously inspected periods are robustness-only.

| h | n | Baseline MALE | Candidate MALE | Relative improvement | Bootstrap 95% | Holm p | Direction |
|---:|---:|---:|---:|---:|---|---:|---:|
| 14 | 4 | 0.054510 | 0.025451 | 53.31% | [-0.033084, 0.082927] | 0.7760 | 75.0% |
| 30 | 4 | 0.061814 | 0.102242 | -65.40% | [-0.123190, 0.042334] | 1.0000 | 100.0% |
| 60 | 4 | 0.142359 | 0.157353 | -10.53% | [-0.157157, 0.083750] | 1.0000 | 50.0% |
| 90 | 4 | 0.239683 | 0.237547 | 0.89% | [-0.140620, 0.160327] | 1.0000 | 50.0% |

## Benchmark comparison

| Horizon | Model | Samples | MALE |
|---:|---|---:|---:|
| 14 | reconstructed-current-policy | 4 | 0.054510 |
| 14 | naive-current-price | 4 | 0.081452 |
| 14 | gbm-driftless | 4 | 0.081452 |
| 14 | gbm-recent-drift | 4 | 0.121435 |
| 14 | ma-trend-20-50-200 | 4 | 0.104512 |
| 30 | reconstructed-current-policy | 4 | 0.061814 |
| 30 | naive-current-price | 4 | 0.055295 |
| 30 | gbm-driftless | 4 | 0.055295 |
| 30 | gbm-recent-drift | 4 | 0.143135 |
| 30 | ma-trend-20-50-200 | 4 | 0.106870 |
| 60 | reconstructed-current-policy | 4 | 0.142359 |
| 60 | naive-current-price | 4 | 0.076588 |
| 60 | gbm-driftless | 4 | 0.076588 |
| 60 | gbm-recent-drift | 4 | 0.247511 |
| 60 | ma-trend-20-50-200 | 4 | 0.174982 |
| 90 | reconstructed-current-policy | 4 | 0.239683 |
| 90 | naive-current-price | 4 | 0.079111 |
| 90 | gbm-driftless | 4 | 0.079111 |
| 90 | gbm-recent-drift | 4 | 0.323827 |
| 90 | ma-trend-20-50-200 | 4 | 0.215034 |

## Per-origin provenance sample

| Origin | Target | h | Train start | Train end | Last known target | Coefficients | Interval snapshot | Data hash | Seed | Benchmarks |
|---|---|---:|---|---|---|---|---|---|---:|---|
| 2022-07-14 | 2022-07-28 | 14 | 2010-07-17 | 2022-07-14 | none | c=1.7354e-17, e=5.77456 | n=0, q90=n/a | `7504b3b92a31` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-07-14 | 2022-08-13 | 30 | 2010-07-17 | 2022-07-14 | none | c=1.7354e-17, e=5.77456 | n=0, q90=n/a | `7504b3b92a31` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-07-14 | 2022-09-12 | 60 | 2010-07-17 | 2022-07-14 | none | c=1.7354e-17, e=5.77456 | n=0, q90=n/a | `7504b3b92a31` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2022-07-14 | 2022-10-12 | 90 | 2010-07-17 | 2022-07-14 | none | c=1.7354e-17, e=5.77456 | n=0, q90=n/a | `7504b3b92a31` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2023-07-14 | 2023-07-28 | 14 | 2010-07-17 | 2023-07-14 | 2022-07-28 | c=4.6153e-17, e=5.64330 | n=1, q90=0.08544 | `16f4fef60787` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2023-07-14 | 2023-08-13 | 30 | 2010-07-17 | 2023-07-14 | 2022-08-13 | c=4.6153e-17, e=5.64330 | n=1, q90=0.04543 | `16f4fef60787` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2023-07-14 | 2023-09-12 | 60 | 2010-07-17 | 2023-07-14 | 2022-09-12 | c=4.6153e-17, e=5.64330 | n=1, q90=0.14525 | `16f4fef60787` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2023-07-14 | 2023-10-12 | 90 | 2010-07-17 | 2023-07-14 | 2022-10-12 | c=4.6153e-17, e=5.64330 | n=1, q90=0.38332 | `16f4fef60787` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2024-07-13 | 2024-07-27 | 14 | 2010-07-17 | 2024-07-13 | 2023-07-28 | c=3.4767e-17, e=5.68133 | n=2, q90=0.00262 | `5a7ca2785003` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2024-07-13 | 2024-08-12 | 30 | 2010-07-17 | 2024-07-13 | 2023-08-13 | c=3.4767e-17, e=5.68133 | n=2, q90=0.04066 | `5a7ca2785003` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2024-07-13 | 2024-09-11 | 60 | 2010-07-17 | 2024-07-13 | 2023-09-12 | c=3.4767e-17, e=5.68133 | n=2, q90=0.02042 | `5a7ca2785003` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2024-07-13 | 2024-10-11 | 90 | 2010-07-17 | 2024-07-13 | 2023-10-12 | c=3.4767e-17, e=5.68133 | n=2, q90=0.06219 | `5a7ca2785003` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |

The JSON artifact contains nested-selection metadata, robustness, sensitivity, provenance, skip reasons, and all rows. Differences from legacy backtests are methodology findings.
