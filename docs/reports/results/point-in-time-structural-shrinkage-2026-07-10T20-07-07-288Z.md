# Point-In-Time structural-shrinkage Benchmark

Status: report-only; no runtime forecast changes.

## Provenance

- Generated: 2026-07-10T20:07:07.288Z
- Git commit: `28d5c863aaa389e2b8fae6ebaba95b98c392da1e`
- Seed: 1498152960
- Data SHA-256: `23b947fb572a724e75314608e57d56203b734f0cd134a389a30c9d264fab4919`
- Data: 2010-07-17 through 2026-07-09 (5837 rows)
- Close availability: UTC daily close is available after that date closes; structural fit includes the origin close; calibration targets must be strictly earlier than origin.
- Origin rows: 458; skips: 6

## Candidate evaluation

- Candidate: structural-shrinkage
- Verdict: **rejected-development-gate** (research-only)
- Previously inspected periods are robustness-only.

| h | n | Baseline MALE | Candidate MALE | Relative improvement | Bootstrap 95% | Holm p | Direction |
|---:|---:|---:|---:|---:|---|---:|---:|
| 14 | 116 | 0.106246 | 0.106342 | -0.09% | [-0.000202, 0.000001] | 1.0000 | 60.3% |
| 30 | 115 | 0.171794 | 0.172145 | -0.20% | [-0.000635, -0.000108] | 1.0000 | 55.7% |
| 60 | 114 | 0.260094 | 0.260790 | -0.27% | [-0.001405, -0.000070] | 1.0000 | 58.8% |
| 90 | 113 | 0.332308 | 0.333262 | -0.29% | [-0.002240, 0.000074] | 1.0000 | 57.5% |

## Benchmark comparison

| Horizon | Model | Samples | MALE |
|---:|---|---:|---:|
| 14 | reconstructed-current-policy | 116 | 0.106246 |
| 14 | naive-current-price | 116 | 0.104699 |
| 14 | gbm-driftless | 116 | 0.104699 |
| 14 | gbm-recent-drift | 116 | 0.115695 |
| 14 | ma-trend-20-50-200 | 116 | 0.108917 |
| 30 | reconstructed-current-policy | 115 | 0.171794 |
| 30 | naive-current-price | 115 | 0.167511 |
| 30 | gbm-driftless | 115 | 0.167511 |
| 30 | gbm-recent-drift | 115 | 0.190518 |
| 30 | ma-trend-20-50-200 | 115 | 0.173733 |
| 60 | reconstructed-current-policy | 114 | 0.260094 |
| 60 | naive-current-price | 114 | 0.259689 |
| 60 | gbm-driftless | 114 | 0.259689 |
| 60 | gbm-recent-drift | 114 | 0.316792 |
| 60 | ma-trend-20-50-200 | 114 | 0.272068 |
| 90 | reconstructed-current-policy | 113 | 0.332308 |
| 90 | naive-current-price | 113 | 0.331214 |
| 90 | gbm-driftless | 113 | 0.331214 |
| 90 | gbm-recent-drift | 113 | 0.432699 |
| 90 | ma-trend-20-50-200 | 113 | 0.355541 |

## Per-origin provenance sample

| Origin | Target | h | Train start | Train end | Last known target | Coefficients | Interval snapshot | Data hash | Seed | Benchmarks |
|---|---|---:|---|---|---|---|---|---|---:|---|
| 2017-01-11 | 2017-01-25 | 14 | 2010-07-17 | 2017-01-11 | none | c=2.1018e-17, e=5.74912 | n=0, q90=n/a | `23a2178a8a50` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-01-11 | 2017-02-10 | 30 | 2010-07-17 | 2017-01-11 | none | c=2.1018e-17, e=5.74912 | n=0, q90=n/a | `23a2178a8a50` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-01-11 | 2017-03-12 | 60 | 2010-07-17 | 2017-01-11 | none | c=2.1018e-17, e=5.74912 | n=0, q90=n/a | `23a2178a8a50` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-01-11 | 2017-04-11 | 90 | 2010-07-17 | 2017-01-11 | none | c=2.1018e-17, e=5.74912 | n=0, q90=n/a | `23a2178a8a50` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-02-10 | 2017-02-24 | 14 | 2010-07-17 | 2017-02-10 | 2017-01-25 | c=2.3493e-17, e=5.73286 | n=1, q90=0.01105 | `3084ea383507` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-02-10 | 2017-03-12 | 30 | 2010-07-17 | 2017-02-10 | none | c=2.3493e-17, e=5.73286 | n=0, q90=n/a | `3084ea383507` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-02-10 | 2017-04-11 | 60 | 2010-07-17 | 2017-02-10 | none | c=2.3493e-17, e=5.73286 | n=0, q90=n/a | `3084ea383507` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-02-10 | 2017-05-11 | 90 | 2010-07-17 | 2017-02-10 | none | c=2.3493e-17, e=5.73286 | n=0, q90=n/a | `3084ea383507` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-03-12 | 2017-03-26 | 14 | 2010-07-17 | 2017-03-12 | 2017-02-24 | c=2.5805e-17, e=5.71914 | n=2, q90=0.01105 | `b70dce131c7e` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-03-12 | 2017-04-11 | 30 | 2010-07-17 | 2017-03-12 | 2017-02-10 | c=2.5805e-17, e=5.71914 | n=1, q90=0.00985 | `b70dce131c7e` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-03-12 | 2017-05-11 | 60 | 2010-07-17 | 2017-03-12 | none | c=2.5805e-17, e=5.71914 | n=0, q90=n/a | `b70dce131c7e` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |
| 2017-03-12 | 2017-06-10 | 90 | 2010-07-17 | 2017-03-12 | none | c=2.5805e-17, e=5.71914 | n=0, q90=n/a | `b70dce131c7e` | 1498152960 | reconstructed-current-policy, naive-current-price, gbm-driftless, gbm-recent-drift, ma-trend-20-50-200 |

The JSON artifact contains nested-selection metadata, robustness, sensitivity, provenance, skip reasons, and all rows. Differences from legacy backtests are methodology findings.
