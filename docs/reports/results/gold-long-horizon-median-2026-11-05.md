# Gold long-horizon median and projected channel — 2026-11-05

Verdict: **promoted**.

## Problem

The gold median drift was one momentum term extrapolated forever. The 10-year
median was +106%, and the projected channel floor sat above the median for 10
years, so the projected candles rode the floor. Monthly gold since 1972 does not
support extrapolating recent momentum that far.

## What changed

`src/lib/marketForecast.ts` adds `GOLD_MOMENTUM_DAYS = 365` and
`GOLD_LONG_RUN_DRIFT = Math.log(1.04) / 365`. The gold median keeps one year of
momentum, then continues at 4%/yr per calendar day. `genericMedianLogReturnAtDay`
owns the curve, and the stochastic traces, the heatmap increments and the
probability summary use it. The projected channel trend is now a rolling SMA fed
with the horizon-independent reference path, with the same window as the history
chart (gold 252 days, S&P 500 126). The old `latestChannel.trend * exp(drift * day)`
made the floor horizon-dependent and above the median. Days ≤ 365 are unchanged:
at day 365 the momentum term already fills the whole path.

## Evidence

Monthly spot gold 1972-2026 (datahub.io/core/gold-prices), run with
`npx tsx scripts/research-gold-long-median.ts --csv <monthly.csv>`.
MAE gain vs A (momentum forever), Newey-West t in parentheses. A scores 0.168 /
0.284 / 0.600 / 1.030 (1975-2003) and 0.137 / 0.236 / 0.470 / 1.001 (2004+).
n = 348 origins in 1975-2003; 262 / 250 / 214 / 154 in 2004+ at 12/24/60/120 months.

| origins | h | B 1y → expanding mean | C 1y → zero | D expanding only | E 1y → 4%/yr |
|---|---:|---:|---:|---:|---:|
| 1975-2003 | 12 | 0% (0.0) | 0% (0.0) | −14% (−1.2) | 0% (0.0) |
| 1975-2003 | 24 | +5% (0.6) | +12% (2.2) | −16% (−1.0) | +12% (2.5) |
| 1975-2003 | 60 | +4% (0.2) | +29% (2.6) | −9% (−0.4) | +31% (3.0) |
| 1975-2003 | 120 | −25% (−1.0) | +42% (2.5) | −35% (−1.2) | +42% (2.6) |
| 2004+ | 12 | 0% (0.0) | 0% (0.0) | −0% (−0.0) | 0% (0.0) |
| 2004+ | 24 | +11% (2.3) | −2% (−0.2) | +5% (0.6) | +7% (1.1) |
| 2004+ | 60 | +26% (1.9) | +1% (0.0) | +23% (1.6) | +18% (0.8) |
| 2004+ | 120 | +56% (4.1) | +45% (2.4) | +58% (4.4) | +63% (4.2) |

E is chosen. It is the only candidate that never loses in either period, and it
wins the 10-year row in both. B loses 25% at 10 years in the older period. D
loses 35% there. C gains less than E at 10 years in both periods.

## Live effect

| view | before | after |
|---|---:|---:|
| 5Y median | $529 (+44%) | $464 (+25.8%) |
| 10Y median | $760 (+106%) | $564 (+53%) |
| 10Y p(up) | 0.89 | 0.77 |

## Gate

`npm run backtest:market-production`: `[sp500 vs legacy] PASS`,
`[sp500 vs priceOnly] PASS`, `[gold vs legacy] PASS`. Horizons ≤ 365 are
unchanged, so every gate result matches the pre-change run.

## Caveats

- 4%/yr is a calibration knob, a round long-run prior. It is not fit.
- The 365-day ridge median (+33%) is still steeper than the 2Y path. That
  inconsistency across horizons is unchanged.
- The monthly data is spot gold, not GLD. The live asset is GLD.
