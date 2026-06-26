# BTC Sentiment Extremes Event Study

Generated: 2026-06-26T05:08:19.361Z

## Setup

- Validation: 2022-01-01 through 2024-12-31
- Final holdout: 2025-01-01 through latest available target
- Baseline: powerlaw-current median forecast
- Model form: event-specific candidate median = baseline median * exp(validation-selected coefficient); only active-event origins are evaluated.
- Leakage policy: sentiment features are one-day lagged through build-feature-table.ts; price baselines use feature rows keyed by forecast origin.
- Promotion gate: at least 10 thinned holdout samples, positive validation improvement, positive holdout improvement with positive lower95 bound, and event behavior better than its price-only baseline.

## Event summary

### extreme-fear

- Verdict: **reject** — No eligible sentiment event passed the thinned holdout promotion gate.
- Description: Fear & Greed index at or below 25.
- Price baseline: drawdown-or-negative-momentum
- Holdout thinned target horizons:
  - 7d: samples=25, coefficient=0.0000, mean improvement=0.00%, lower95=0.00%, upRate=44.00%, priceBaselineUpRate=45.28%, medianReturn=-1.55%
  - 14d: samples=12, coefficient=0.0300, mean improvement=-1.16%, lower95=-1.16%, upRate=41.67%, priceBaselineUpRate=44.00%, medianReturn=-1.29%
  - 30d: samples=5, coefficient=0.0000, mean improvement=0.00%, lower95=n/a, upRate=40.00%, priceBaselineUpRate=33.33%, medianReturn=-0.67%
  - 60d: samples=3, coefficient=-0.1000, mean improvement=-1.95%, lower95=n/a, upRate=66.67%, priceBaselineUpRate=50.00%, medianReturn=4.09%

### extreme-greed

- Verdict: **reject** — No eligible sentiment event passed the thinned holdout promotion gate.
- Description: Fear & Greed index at or above 75.
- Price baseline: positive-momentum-or-rich-residual
- Holdout thinned target horizons:
  - 7d: samples=3, coefficient=0.0000, mean improvement=0.00%, lower95=n/a, upRate=33.33%, priceBaselineUpRate=45.00%, medianReturn=-0.93%
  - 14d: samples=2, coefficient=-0.0300, mean improvement=0.00%, lower95=n/a, upRate=50.00%, priceBaselineUpRate=40.00%, medianReturn=-2.70%
  - 30d: samples=0, coefficient=-0.0600, mean improvement=n/a, lower95=n/a, upRate=n/a, priceBaselineUpRate=50.00%, medianReturn=n/a
  - 60d: samples=0, coefficient=-0.1600, mean improvement=n/a, lower95=n/a, upRate=n/a, priceBaselineUpRate=50.00%, medianReturn=n/a

### fear-after-drawdown

- Verdict: **reject** — No eligible sentiment event passed the thinned holdout promotion gate.
- Description: Extreme fear after a drawdown of at least 20%.
- Price baseline: drawdown-at-least-20pct
- Holdout thinned target horizons:
  - 7d: samples=22, coefficient=0.0000, mean improvement=0.00%, lower95=0.00%, upRate=45.45%, priceBaselineUpRate=42.86%, medianReturn=-1.11%
  - 14d: samples=11, coefficient=0.0300, mean improvement=-1.32%, lower95=-1.32%, upRate=36.36%, priceBaselineUpRate=35.29%, medianReturn=-2.11%
  - 30d: samples=4, coefficient=0.0000, mean improvement=0.00%, lower95=n/a, upRate=50.00%, priceBaselineUpRate=28.57%, medianReturn=5.58%
  - 60d: samples=2, coefficient=-0.1000, mean improvement=0.00%, lower95=n/a, upRate=50.00%, priceBaselineUpRate=50.00%, medianReturn=-7.59%

### greed-after-rally

- Verdict: **reject** — No eligible sentiment event passed the thinned holdout promotion gate.
- Description: Extreme greed with positive residual momentum.
- Price baseline: positive-residual-momentum
- Holdout thinned target horizons:
  - 7d: samples=3, coefficient=0.0000, mean improvement=0.00%, lower95=n/a, upRate=33.33%, priceBaselineUpRate=45.00%, medianReturn=-0.93%
  - 14d: samples=2, coefficient=-0.0300, mean improvement=0.00%, lower95=n/a, upRate=50.00%, priceBaselineUpRate=40.00%, medianReturn=-2.70%
  - 30d: samples=0, coefficient=-0.0300, mean improvement=n/a, lower95=n/a, upRate=n/a, priceBaselineUpRate=50.00%, medianReturn=n/a
  - 60d: samples=0, coefficient=-0.1600, mean improvement=n/a, lower95=n/a, upRate=n/a, priceBaselineUpRate=50.00%, medianReturn=n/a

### sentiment-price-divergence

- Verdict: **reject** — No eligible sentiment event passed the thinned holdout promotion gate.
- Description: Sentiment is fearful while price residual is not cheap.
- Price baseline: non-cheap-residual
- Holdout thinned target horizons:
  - 7d: samples=5, coefficient=0.0000, mean improvement=0.00%, lower95=n/a, upRate=40.00%, priceBaselineUpRate=41.18%, medianReturn=-4.63%
  - 14d: samples=2, coefficient=-0.0600, mean improvement=0.00%, lower95=n/a, upRate=50.00%, priceBaselineUpRate=41.18%, medianReturn=-7.44%
  - 30d: samples=1, coefficient=0.0600, mean improvement=-6.00%, lower95=n/a, upRate=0.00%, priceBaselineUpRate=50.00%, medianReturn=-18.40%
  - 60d: samples=1, coefficient=0.0000, mean improvement=0.00%, lower95=n/a, upRate=0.00%, priceBaselineUpRate=25.00%, medianReturn=-21.52%

