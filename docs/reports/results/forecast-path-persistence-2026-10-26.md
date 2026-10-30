# Forecast path persistence: production-baseline vs date-keyed-v1 (BTC)

Generated 2026-10-26T23:57:25.664Z at `7767d7b+dirty`. Origins every 7 days from 2022-01-01. Verdict: **fail**.

| Horizon | Policy | Origins | Day-over-day change | Range coverage | Relative CRPS | Daily vol | |r| ACF(1) | Max drawdown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 30d | production-baseline | 237 | 11.77% | 83.97% | 8.23% | 2.46% | 0.023 | 11.30% |
| 30d | date-keyed-v1 | 237 | 2.36% | 86.50% | 7.97% | 2.48% | 0.039 | 11.12% |
| 90d | production-baseline | 229 | 16.83% | 88.65% | 12.68% | 2.62% | 0.076 | 20.86% |
| 90d | date-keyed-v1 | 229 | 2.24% | 87.34% | 12.07% | 2.61% | 0.084 | 19.50% |

| Horizon | Gate | Pass |
| --- | --- | --- |
| 30d | persistenceCutAtLeast50pct | yes |
| 30d | coverageWithin2pp | no |
| 30d | crpsNotWorseThan2pct | yes |
| 30d | volWithin10pct | yes |
| 30d | absAcfWithin10pct | no |
| 30d | drawdownWithin10pct | yes |
| 90d | persistenceCutAtLeast50pct | yes |
| 90d | coverageWithin2pp | yes |
| 90d | crpsNotWorseThan2pct | yes |
| 90d | volWithin10pct | yes |
| 90d | absAcfWithin10pct | yes |
| 90d | drawdownWithin10pct | yes |
