# BTC On-Chain Interaction Regimes

Generated: 2026-06-26T04:53:26.666Z

## Setup

- Validation: 2022-01-01 through 2024-12-31
- Final holdout: 2025-01-01 through latest available target
- Baseline: powerlaw-current median forecast
- Model form: state-specific candidate median = baseline median * exp(validation-selected coefficient); only active-state origins are evaluated.
- Leakage policy: feature rows are keyed by forecast origin and source dates are validated one-day lagged; activity/miner trends use only prior feature rows.
- Promotion gate: at least 5 thinned holdout samples at claimed horizon, positive validation improvement, positive holdout improvement with positive lower95 bound, no material adjacent-horizon degradation, and interpretable state definition.

## State summary

### cheap-and-active

- Verdict: **reject** — No eligible interaction state passed the thinned holdout improvement gate.
- Description: Cheap valuation with rising active-address or transaction activity.
- Holdout thinned target horizons:
  - 30d: samples=1, coefficient=0.0000, mean improvement=0.00%, lower95=n/a, median abs log error=0.0077, baseline=0.0077, median forward return=-0.67%
  - 60d: samples=1, coefficient=0.1800, mean improvement=8.02%, lower95=n/a, median abs log error=0.0499, baseline=0.1301, median forward return=12.21%
  - 90d: samples=0, coefficient=0.2500, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 180d: samples=0, coefficient=0.3500, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a

### cheap-and-dead

- Verdict: **reject** — No eligible interaction state passed the thinned holdout improvement gate.
- Description: Cheap valuation with falling active-address and transaction activity.
- Holdout thinned target horizons:
  - 30d: samples=0, coefficient=-0.1200, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 60d: samples=0, coefficient=0.0000, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 90d: samples=0, coefficient=0.0000, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 180d: samples=0, coefficient=0.0000, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a

### miner-stress

- Verdict: **reject** — No eligible interaction state passed the thinned holdout improvement gate.
- Description: Low miner revenue proxy versus prior year plus large drawdown.
- Holdout thinned target horizons:
  - 30d: samples=0, coefficient=-0.0800, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 60d: samples=0, coefficient=-0.1200, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 90d: samples=0, coefficient=-0.1200, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 180d: samples=0, coefficient=-0.3500, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a

### network-expansion

- Verdict: **reject** — No eligible interaction state passed the thinned holdout improvement gate.
- Description: Rising activity trend with positive 30d residual momentum.
- Holdout thinned target horizons:
  - 30d: samples=1, coefficient=0.0000, mean improvement=0.00%, lower95=n/a, median abs log error=0.0414, baseline=0.0414, median forward return=-7.32%
  - 60d: samples=0, coefficient=0.0800, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 90d: samples=0, coefficient=0.0000, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 180d: samples=0, coefficient=0.0800, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a

### valuation-activity-divergence

- Verdict: **reject** — No eligible interaction state passed the thinned holdout improvement gate.
- Description: Cheap valuation paired with weak or negative activity trend.
- Holdout thinned target horizons:
  - 30d: samples=0, coefficient=0.0800, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 60d: samples=0, coefficient=-0.1200, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 90d: samples=0, coefficient=0.0400, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a
  - 180d: samples=0, coefficient=-0.3500, mean improvement=n/a, lower95=n/a, median abs log error=n/a, baseline=n/a, median forward return=n/a

