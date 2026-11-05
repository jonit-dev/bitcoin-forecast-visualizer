# S&P 500 and gold session volatility term structure — 2026-11-05

Verdict: **promoted** for both assets. The median is unchanged. Only the forecast
width changes: the band, the heatmap and the probability summary.

## What changed

The old width was one realized volatility times the square root of the horizon.
S&P 500 used `0.65*vol90 + 0.35*vol252` per session, with 180 days on calendar
days. Gold used `vol252` per *calendar* day, about 1.2 times too wide. The new width:

```
spot     = EWMA of squared daily log returns (half-life H sessions)
var(n)   = n*LR + (spot - LR) * phi * (1 - phi^n) / (1 - phi)     n = market sessions to the day
scale(n) = c * sqrt(var(n))
```

| asset | H | phi | long-run daily vol LR | c |
|---|---:|---:|---:|---:|
| S&P 500 (VOO) | 21 | 0.995 | 0.0106 (S&P 500 index 1970-2018) | 0.86 |
| Gold (GLD) | 42 | 0.97 | 0.0115 (GLD/gold futures before 2019) | 1.00 |

The gold 365-day ridge keeps its validated `sigma*sqrt(365)` width. When the ridge
fails closed, the momentum fallback uses the term structure.

## Method

- `scripts/research-market-volatility.ts` searched the parameters on origins before
  2019 only: S&P 500 index (^GSPC) 1991-2018, gold futures (GC=F) 2002-2018 and GLD
  2009-2018. The score is the pinball loss over q05/q10/q50/q90/q95, averaged over
  7/14/30/90/180/365-day horizons.
- `scripts/backtest-market-production.ts` is the gate. It calls the production
  `buildGenericModelInputs` and `computeGenericProbabilityForecast` at every 5th
  session, from the 1000th row on. Horizons are calendar days. The target is the
  last close on or before origin + horizon. The incumbent is the same inputs with
  `logVarianceByDay` removed. Train is origins before 2019 and holdout is 2019+,
  which includes the 2020, 2022 and 2025 drawdowns. The t statistics are
  Newey-West, with a lag that spans the overlapping horizon.
- Gate, holdout only: no horizon loses pinball score, the mean gain is at least 1%,
  and the 90% band covers 85-95% of outcomes or is no farther from 90% than the
  incumbent.

## Gate result (`npm run backtest:market-production`, JSON alongside)

Pinball change (positive = better), Newey-West t, and 90% / 80% coverage incumbent → new.

| asset | h | train gain (t) | holdout gain (t) | holdout cov90 | holdout cov80 |
|---|---:|---:|---:|---:|---:|
| S&P 500 | 7 | +0.5% (0.36) | **+3.9% (3.22)** | 91.6 → 87.2 | 83.9 → 78.6 |
| S&P 500 | 14 | +2.3% (1.87) | **+4.2% (3.26)** | 91.8 → 88.7 | 87.7 → 81.3 |
| S&P 500 | 30 | +1.8% (0.89) | +2.8% (1.62) | 91.0 → 87.1 | 85.3 → 81.0 |
| S&P 500 | 90 | +1.2% (0.64) | **+6.0% (2.89)** | 91.9 → 90.3 | 88.5 → 86.1 |
| S&P 500 | 180 | −1.2% (−0.20) | +7.1% (1.30) | 92.4 → 85.6 | 86.4 → 81.0 |
| S&P 500 | 365 | +0.5% (0.17) | **+7.6% (2.60)** | 92.1 → 90.1 | 86.9 → 84.0 |
| Gold | 7 | **+7.2% (8.35)** | +1.8% (1.93) | 92.6 → 89.6 | 86.3 → 81.4 |
| Gold | 14 | **+6.7% (6.56)** | +1.8% (1.93) | 93.1 → 90.1 | 86.2 → 82.4 |
| Gold | 30 | **+6.5% (4.91)** | **+2.8% (3.07)** | 95.4 → 93.1 | 87.1 → 82.5 |
| Gold | 90 | **+7.0% (3.48)** | +2.1% (1.49) | 94.0 → 94.0 | 86.4 → 82.4 |
| Gold | 180 | **+7.9% (2.39)** | +0.8% (0.46) | 91.1 → 93.8 | 79.7 → 79.1 |
| Gold | 365 | +6.3% (1.46)¹ | 0.0% (ridge, unchanged) | 96.5 → 96.5 | 90.7 → 90.7 |

¹ Origins where the ridge failed closed for lack of macro history.

S&P 500 n = 219 train / 343-392 holdout origins. Gold n = 511 train / 343-393 holdout origins.
Brier score of `probabilityUp` improves or holds on every S&P holdout horizon (for example,
365 days 0.156 → 0.149).

One-off replication on the S&P 500 index, 2019+ origins, with an incumbent-style
width and an expanding-mean median (not kept as a script): +4.3% to +15.7% pinball
at 7/30/90/365/730/1825 days, t = 2.8-5.2.

## Tried and not promoted

| candidate | result | why not |
|---|---|---|
| S&P 500 width from VIX (lagged one session), c = 0.70 | holdout +5.6% to +11.6% at every horizon (t 1.9-5.5), mean +9.0% vs +5.3% price-only | Production has no fresh VIX. The bundled data refreshes about monthly and live VOO candles run past it, so VIX would be stale or fail closed most days. Needs a VIX feed in the quote worker first. |
| Gold width from GVZ | holdout about +2%, no better than EWMA | Same runtime staleness, no gain |
| Gold term structure at the pre-2019 optimum c = 0.86 | train +9.9%, holdout 90% coverage 84.7-87.1%, 80% coverage 74-78%, 180 days −2.4% | Fails holdout calibration. c = 1 was then chosen, which uses holdout information. Read the gold holdout as weaker evidence than the S&P holdout. |
| Gold median on sessions instead of calendar days (the units fix) | MAE train +0 to +3.9%, holdout −0.1 to −4.2%, all \|t\| ≤ 1.6 | No signal either way. The calendar-day drift stays. |
| Gold median: zero, expanding mean, larger or uncapped momentum | no variant beats the incumbent on both periods | Momentum carries value: a zero median loses 21.6% holdout pinball |

## Caveats

- The S&P 500 CSR residual trees were fit on labels through 2026-01-01, so the
  S&P median is in-sample on this window. The width change is isolated from it
  because both arms use the same median.
- At 2-5 years on VOO, the 2014-2018 origins favor the old, narrower width
  (−5% to −6%, t up to −3.3). The new long-run level (16.8% a year) is wider
  than that calm period. The S&P 500 index 1991-2018 and every 2019+ window
  favor the new width.
- Overlapping horizons make the effective sample much smaller than n at 180 and
  365 days. The t statistics account for this, but the coverage percentages do not.

## Pre-existing, not caused by this change

- `npm run backtest:market` already fails at HEAD 212bb05: gold 30-day MAE
  improvement p = 0.062. That gate tests drift and `dailyVol`, which this change
  does not touch.
- The gold 365-day ridge fails closed as soon as live GLD candles pass the
  bundled `gold-macro-history.json`. Production therefore shows the momentum
  fallback until the next bundle refresh.
