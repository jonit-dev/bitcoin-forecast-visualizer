# BTC Macro Liquidity Regime Experiment

Generated: 2026-06-26T05:23:29.014Z

## Setup

- Validation: 2023-08-01 through 2024-12-31
- Final holdout: 2025-01-01 through latest available target
- Baseline: powerlaw-current median and sigma
- Model form: candidate median unchanged; sigma widened or narrowed for transparent macro regimes with scale selected on validation only.
- Leakage policy: macro rows use latest FRED observations with conservative 30-day availableAfter lag before feature-table joins.
- Promotion gate: NLL or q05/q95 pinball improves on 30/60/90d holdout with positive lower95, coverage remains sane, and median absolute log error does not materially degrade.
- Limitation: FRED latest observations are not ALFRED vintages; high-yield spread series currently starts 2023-06-26, shortening validation history.

## Regime summary

### macro-stress

- Verdict: **reject** — No macro regime passed the holdout interval promotion gate.
- Description: High macro risk score or high-yield spread z-score.
- Sigma direction: widen
- Holdout thinned metrics:
  - 30d: samples=3, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=4.0%
  - 60d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=15.1%
  - 90d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=17.9%
  - 180d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=14.9%

### credit-stress

- Verdict: **reject** — No macro regime passed the holdout interval promotion gate.
- Description: High-yield spread at least one prior-year z-score above normal.
- Sigma direction: widen
- Holdout thinned metrics:
  - 30d: samples=3, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=4.0%
  - 60d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=15.1%
  - 90d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=17.9%
  - 180d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=14.9%

### liquidity-easing

- Verdict: **reject** — No macro regime passed the holdout interval promotion gate.
- Description: Positive balance-sheet impulse and low macro risk score.
- Sigma direction: narrow
- Holdout thinned metrics:
  - 30d: samples=2, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=6.1%
  - 60d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=12.2%
  - 90d: samples=0, scale=0, nllImprovement=n/a, lower95=n/a, coverage90=n/a, baselineCoverage90=n/a, medianReturn=n/a
  - 180d: samples=0, scale=0, nllImprovement=n/a, lower95=n/a, coverage90=n/a, baselineCoverage90=n/a, medianReturn=n/a

### tightening-pressure

- Verdict: **reject** — No macro regime passed the holdout interval promotion gate.
- Description: Negative balance-sheet impulse or rising rates with elevated macro risk.
- Sigma direction: widen
- Holdout thinned metrics:
  - 30d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=11.1%
  - 60d: samples=1, scale=0.5, nllImprovement=-0.3057, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=15.1%
  - 90d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=17.9%
  - 180d: samples=1, scale=0, nllImprovement=0.0000, lower95=n/a, coverage90=100.0%, baselineCoverage90=100.0%, medianReturn=14.9%

