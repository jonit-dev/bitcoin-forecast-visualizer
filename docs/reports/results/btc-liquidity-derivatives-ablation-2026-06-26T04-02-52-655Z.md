# BTC Stablecoin Liquidity + Derivatives Ablation

Generated: 2026-06-26T04:02:52.655Z

## Setup

- Validation: 2022-01-01 through 2024-12-31
- Final holdout: 2025-01-01 through latest available target
- Model form: candidate median = baseline median * exp(coefficient * featureComposite); coefficient selected on validation grid only
- Leakage policy: feature-table sources are one-day lagged; this script additionally uses expanding-z normalization from prior feature rows only.
- Overlap caution: Daily labels overlap; thinned metrics use origin spacing equal to horizon days and are the promotion gate.

## Candidate summary

### stablecoin-supply-z365

- Family: stablecoin
- Verdict: **context-only** — Some target-horizon improvement exists, but it is not stable enough across thinned horizons to promote.
- Features: stablecoinSupplyZ365d
- Holdout thinned target horizons:
  - 30d: samples=17, mean improvement=0.00%, median abs log error=0.0414, bootstrap lower95=0.00%
  - 60d: samples=8, mean improvement=-3.74%, median abs log error=0.1367, bootstrap lower95=n/a
  - 90d: samples=5, mean improvement=0.64%, median abs log error=0.0847, bootstrap lower95=n/a
  - 180d: samples=2, mean improvement=-1.92%, median abs log error=0.1382, bootstrap lower95=n/a

### stablecoin-30d-impulse

- Family: stablecoin
- Verdict: **context-only** — Some target-horizon improvement exists, but it is not stable enough across thinned horizons to promote.
- Features: stablecoinSupplyChange30d
- Holdout thinned target horizons:
  - 30d: samples=17, mean improvement=-0.26%, median abs log error=0.0534, bootstrap lower95=-0.26%
  - 60d: samples=8, mean improvement=-0.73%, median abs log error=0.0899, bootstrap lower95=n/a
  - 90d: samples=5, mean improvement=0.08%, median abs log error=0.1170, bootstrap lower95=n/a
  - 180d: samples=2, mean improvement=0.04%, median abs log error=0.1186, bootstrap lower95=n/a

### stablecoin-90d-impulse

- Family: stablecoin
- Verdict: **context-only** — Some target-horizon improvement exists, but it is not stable enough across thinned horizons to promote.
- Features: stablecoinSupplyChange90d
- Holdout thinned target horizons:
  - 30d: samples=17, mean improvement=-0.22%, median abs log error=0.0521, bootstrap lower95=-0.22%
  - 60d: samples=8, mean improvement=-0.99%, median abs log error=0.0795, bootstrap lower95=n/a
  - 90d: samples=5, mean improvement=0.10%, median abs log error=0.1156, bootstrap lower95=n/a
  - 180d: samples=2, mean improvement=0.05%, median abs log error=0.1186, bootstrap lower95=n/a

### stablecoin-liquidity-impulse

- Family: stablecoin
- Verdict: **context-only** — Some target-horizon improvement exists, but it is not stable enough across thinned horizons to promote.
- Features: stablecoinLiquidityImpulse30dVsAnnual
- Holdout thinned target horizons:
  - 30d: samples=17, mean improvement=-0.24%, median abs log error=0.0527, bootstrap lower95=-0.24%
  - 60d: samples=8, mean improvement=-1.05%, median abs log error=0.0778, bootstrap lower95=n/a
  - 90d: samples=5, mean improvement=0.11%, median abs log error=0.1152, bootstrap lower95=n/a
  - 180d: samples=2, mean improvement=0.05%, median abs log error=0.1185, bootstrap lower95=n/a

### stablecoin-dry-powder-ratio

- Family: stablecoin
- Verdict: **context-only** — Some target-horizon improvement exists, but it is not stable enough across thinned horizons to promote.
- Features: stablecoinSupplyToBtcMarketCap
- Holdout thinned target horizons:
  - 30d: samples=17, mean improvement=0.00%, median abs log error=0.0414, bootstrap lower95=0.00%
  - 60d: samples=8, mean improvement=0.00%, median abs log error=0.1191, bootstrap lower95=n/a
  - 90d: samples=5, mean improvement=0.41%, median abs log error=0.1253, bootstrap lower95=n/a
  - 180d: samples=2, mean improvement=-0.28%, median abs log error=0.1218, bootstrap lower95=n/a

### derivatives-funding-z90

- Family: derivatives
- Verdict: **reject** — Did not show stable thinned holdout improvement over current power-law baseline.
- Features: futuresFundingRateSumZ90d
- Holdout thinned target horizons:
  - 7d: samples=75, mean improvement=0.00%, median abs log error=0.0378, bootstrap lower95=0.00%
  - 14d: samples=37, mean improvement=0.00%, median abs log error=0.0384, bootstrap lower95=0.00%
  - 30d: samples=17, mean improvement=-0.18%, median abs log error=0.0615, bootstrap lower95=-0.18%
  - 60d: samples=8, mean improvement=-1.99%, median abs log error=0.1180, bootstrap lower95=n/a

### derivatives-funding-30d

- Family: derivatives
- Verdict: **reject** — Did not show stable thinned holdout improvement over current power-law baseline.
- Features: futuresFundingRateSum30d
- Holdout thinned target horizons:
  - 7d: samples=75, mean improvement=0.00%, median abs log error=0.0378, bootstrap lower95=0.00%
  - 14d: samples=37, mean improvement=0.00%, median abs log error=0.0384, bootstrap lower95=0.00%
  - 30d: samples=17, mean improvement=-0.37%, median abs log error=0.0498, bootstrap lower95=-0.37%
  - 60d: samples=8, mean improvement=-0.42%, median abs log error=0.0664, bootstrap lower95=n/a

### derivatives-premium-z90

- Family: derivatives
- Verdict: **reject** — Did not show stable thinned holdout improvement over current power-law baseline.
- Features: futuresPremiumCloseZ90d
- Holdout thinned target horizons:
  - 7d: samples=75, mean improvement=0.00%, median abs log error=0.0378, bootstrap lower95=0.00%
  - 14d: samples=37, mean improvement=0.00%, median abs log error=0.0384, bootstrap lower95=0.00%
  - 30d: samples=17, mean improvement=0.00%, median abs log error=0.0414, bootstrap lower95=0.00%
  - 60d: samples=8, mean improvement=-1.80%, median abs log error=0.1304, bootstrap lower95=n/a

### derivatives-premium-range

- Family: derivatives
- Verdict: **reject** — Did not show stable thinned holdout improvement over current power-law baseline.
- Features: futuresPremiumRange
- Holdout thinned target horizons:
  - 7d: samples=75, mean improvement=0.00%, median abs log error=0.0378, bootstrap lower95=0.00%
  - 14d: samples=37, mean improvement=-0.12%, median abs log error=0.0437, bootstrap lower95=-0.52%
  - 30d: samples=17, mean improvement=-0.13%, median abs log error=0.0538, bootstrap lower95=-0.13%
  - 60d: samples=8, mean improvement=-0.24%, median abs log error=0.1195, bootstrap lower95=n/a

### derivatives-crowding-composite

- Family: derivatives
- Verdict: **reject** — Did not show stable thinned holdout improvement over current power-law baseline.
- Features: futuresFundingRateSumZ90d, futuresPremiumCloseZ90d
- Holdout thinned target horizons:
  - 7d: samples=75, mean improvement=0.00%, median abs log error=0.0378, bootstrap lower95=0.00%
  - 14d: samples=37, mean improvement=0.00%, median abs log error=0.0384, bootstrap lower95=0.00%
  - 30d: samples=17, mean improvement=-0.16%, median abs log error=0.0583, bootstrap lower95=-0.16%
  - 60d: samples=8, mean improvement=-1.60%, median abs log error=0.1243, bootstrap lower95=n/a

