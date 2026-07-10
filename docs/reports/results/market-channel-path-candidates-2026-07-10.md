# Market channel path candidate report — 2026-07-10

This report applies the pre-registered statistical gate. Visual curvature is not a promotion condition.

Git commit: `12c744337ea237fe13d8368672226afe2782a63c`
Configuration version: `market-channel-path-v1`

## sp500

Verdict: **needs-more-data**

| Lead | N | Non-overlap eq. | Baseline score | Candidate score | Improvement | Baseline cov. | Candidate cov. | Corrected p |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 48 | 288.0 | 123.3792 | 45.9834 | 62.73% | 93.8% | 87.5% | 0.0000 |
| 10 | 47 | 141.0 | 126.9304 | 64.4949 | 49.19% | 93.6% | 91.5% | 0.0000 |
| 20 | 46 | 69.0 | 119.0520 | 59.7103 | 49.85% | 89.1% | 100.0% | 0.0000 |
| 30 | 46 | 46.0 | 129.5931 | 83.3246 | 35.70% | 87.0% | 95.7% | 0.0000 |
| 60 | 44 | 22.0 | 161.5734 | 121.0761 | 25.06% | 70.5% | 95.5% | 0.1800 |
| 90 | 42 | 14.0 | 231.9650 | 154.5400 | 33.38% | 66.7% | 95.2% | 0.1800 |
| 120 | 40 | 10.0 | 269.7710 | 184.8442 | 31.48% | 67.5% | 90.0% | 0.5250 |
| 180 | 36 | 6.0 | 462.2025 | 238.8315 | 48.33% | 41.7% | 94.4% | 0.0210 |

Invalid paths: 0; target-date/session mismatches: 35.

## gold

Verdict: **needs-more-data**

| Lead | N | Non-overlap eq. | Baseline score | Candidate score | Improvement | Baseline cov. | Candidate cov. | Corrected p |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 65 | 390.0 | 50.2099 | 16.3329 | 67.47% | 93.8% | 86.2% | 0.0000 |
| 10 | 65 | 195.0 | 57.5220 | 21.0949 | 63.33% | 90.8% | 87.7% | 0.0000 |
| 20 | 65 | 97.5 | 60.9627 | 27.4472 | 54.98% | 86.2% | 89.2% | 0.0000 |
| 30 | 64 | 64.0 | 61.7948 | 34.8589 | 43.59% | 89.1% | 90.6% | 0.0000 |
| 60 | 61 | 30.5 | 88.8610 | 53.7468 | 39.52% | 73.8% | 88.5% | 0.0390 |
| 90 | 58 | 19.3 | 140.9889 | 84.0700 | 40.37% | 65.5% | 82.8% | 0.1410 |
| 120 | 55 | 13.8 | 193.9458 | 105.6695 | 45.52% | 56.4% | 78.2% | 0.1470 |
| 180 | 49 | 8.2 | 283.5823 | 127.0392 | 55.20% | 46.9% | 77.6% | 0.0240 |

Invalid paths: 0; target-date/session mismatches: 54.

## Verdict

At least one required gate fails or lacks sufficient independent outcomes. Retain current runtime channels; Phase 3 is not authorized.

