# BTC Dynamic Volatility Interval Experiment

Generated: 2026-06-26T04:50:09.423Z

## Setup

- Validation: 2022-01-01 through 2024-12-31
- Final holdout: 2025-01-01 through latest available target
- Baseline: powerlaw-current median and current computePowerLawInterval sigma
- Model form: candidate median is unchanged; only sigma and derived lognormal quantiles change.
- Leakage policy: all realized-volatility inputs use BTC rows at or before the forecast origin.
- Promotion gate: final-holdout NLL improves on 7/14/30d with positive lower 95% block-bootstrap bounds, 90% coverage remains roughly 85-95%, and tail pinball does not worsen on both tails.

## Selected candidate summary

### downside-lb7-t0.16-s0.2

- Verdict: **reject** — Did not improve required holdout NLL versus current interval baseline.
- Description: Baseline sigma widened asymmetrically after large downside moves.
- Params: {"lookback":7,"threshold":-0.16,"scale":0.2}
- Holdout thinned metrics:
  - 7d: samples=75, nllImprovement=-0.0013, lower95=-0.0038, coverage90=92.0%, baselineCoverage90=92.0%, width90=0.2075, baselineWidth90=0.2070
  - 14d: samples=37, nllImprovement=0.0000, lower95=0.0000, coverage90=91.9%, baselineCoverage90=91.9%, width90=0.2871, baselineWidth90=0.2871
  - 30d: samples=17, nllImprovement=0.0000, lower95=0.0000, coverage90=94.1%, baselineCoverage90=94.1%, width90=0.3983, baselineWidth90=0.3983
  - 60d: samples=8, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, width90=0.5338, baselineWidth90=0.5338

### downside-lb30-t0.16-s0.2

- Verdict: **reject** — Did not improve required holdout NLL versus current interval baseline.
- Description: Baseline sigma widened asymmetrically after large downside moves.
- Params: {"lookback":30,"threshold":-0.16,"scale":0.2}
- Holdout thinned metrics:
  - 7d: samples=75, nllImprovement=-0.0180, lower95=-0.0311, coverage90=92.0%, baselineCoverage90=92.0%, width90=0.2122, baselineWidth90=0.2070
  - 14d: samples=37, nllImprovement=-0.0172, lower95=-0.0300, coverage90=91.9%, baselineCoverage90=91.9%, width90=0.2937, baselineWidth90=0.2871
  - 30d: samples=17, nllImprovement=-0.0211, lower95=-0.0211, coverage90=94.1%, baselineCoverage90=94.1%, width90=0.4076, baselineWidth90=0.3983
  - 60d: samples=8, nllImprovement=-0.0129, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, width90=0.5486, baselineWidth90=0.5338

### downside-lb7-t0.12-s0.2

- Verdict: **reject** — Did not improve required holdout NLL versus current interval baseline.
- Description: Baseline sigma widened asymmetrically after large downside moves.
- Params: {"lookback":7,"threshold":-0.12,"scale":0.2}
- Holdout thinned metrics:
  - 7d: samples=75, nllImprovement=-0.0036, lower95=-0.0084, coverage90=92.0%, baselineCoverage90=92.0%, width90=0.2081, baselineWidth90=0.2070
  - 14d: samples=37, nllImprovement=-0.0042, lower95=-0.0127, coverage90=91.9%, baselineCoverage90=91.9%, width90=0.2889, baselineWidth90=0.2871
  - 30d: samples=17, nllImprovement=0.0000, lower95=0.0000, coverage90=94.1%, baselineCoverage90=94.1%, width90=0.3983, baselineWidth90=0.3983
  - 60d: samples=8, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, width90=0.5338, baselineWidth90=0.5338

