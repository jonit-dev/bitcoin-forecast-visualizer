# Market channel path baseline report — 2026-07-10

The frozen-residual baseline has affine log bounds, so its second differences are numerically zero. Curvature is diagnostic only.

Git commit: `12c744337ea237fe13d8368672226afe2782a63c`
Configuration version: `market-channel-path-v1`

## sp500

Verdict: **baseline-only**

| Lead | N | Non-overlap eq. | Baseline score | Candidate score | Improvement | Baseline cov. | Candidate cov. | Corrected p |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 48 | 288.0 | 123.3792 | 123.3792 | 0.00% | 93.8% | 93.8% | 1.0000 |
| 10 | 47 | 141.0 | 126.9304 | 126.9304 | 0.00% | 93.6% | 93.6% | 1.0000 |
| 20 | 46 | 69.0 | 119.0520 | 119.0520 | 0.00% | 89.1% | 89.1% | 1.0000 |
| 30 | 46 | 46.0 | 129.5931 | 129.5931 | 0.00% | 87.0% | 87.0% | 1.0000 |
| 60 | 44 | 22.0 | 161.5734 | 161.5734 | 0.00% | 70.5% | 70.5% | 1.0000 |
| 90 | 42 | 14.0 | 231.9650 | 231.9650 | 0.00% | 66.7% | 66.7% | 1.0000 |
| 120 | 40 | 10.0 | 269.7710 | 269.7710 | 0.00% | 67.5% | 67.5% | 1.0000 |
| 180 | 36 | 6.0 | 462.2025 | 462.2025 | 0.00% | 41.7% | 41.7% | 1.0000 |

Invalid paths: 0; target-date/session mismatches: 35.

## gold

Verdict: **baseline-only**

| Lead | N | Non-overlap eq. | Baseline score | Candidate score | Improvement | Baseline cov. | Candidate cov. | Corrected p |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 65 | 390.0 | 50.2099 | 50.2099 | 0.00% | 93.8% | 93.8% | 1.0000 |
| 10 | 65 | 195.0 | 57.5220 | 57.5220 | 0.00% | 90.8% | 90.8% | 1.0000 |
| 20 | 65 | 97.5 | 60.9627 | 60.9627 | 0.00% | 86.2% | 86.2% | 1.0000 |
| 30 | 64 | 64.0 | 61.7948 | 61.7948 | 0.00% | 89.1% | 89.1% | 1.0000 |
| 60 | 61 | 30.5 | 88.8610 | 88.8610 | 0.00% | 73.8% | 73.8% | 1.0000 |
| 90 | 58 | 19.3 | 140.9889 | 140.9889 | 0.00% | 65.5% | 65.5% | 1.0000 |
| 120 | 55 | 13.8 | 193.9458 | 193.9458 | 0.00% | 56.4% | 56.4% | 1.0000 |
| 180 | 49 | 8.2 | 283.5823 | 283.5823 | 0.00% | 46.9% | 46.9% | 1.0000 |

Invalid paths: 0; target-date/session mismatches: 54.

## Verdict

Baseline quantified; no runtime change is authorized.

