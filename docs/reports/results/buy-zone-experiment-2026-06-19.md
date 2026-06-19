# BTC heavy buy zone experiment — 2026-06-19

## Hypothesis

A statistically useful heavy-buy zone can be spotted from the existing BTC feature flow using only past-known data, analogous to the existing top/trim zone but aimed at bottoms.

The candidate should avoid future-known cycle pivots. It should be based on live-observable stress/cheapness features:

- `priceResidualLog` percentile vs prior history: price cheap versus the power-law baseline.
- `mvrvPercentile`: MVRV cheap versus running history.
- `realizedPriceDistance` percentile vs prior history: close to realized price.
- `drawdownFromCycleHigh` pain percentile vs prior history: deep drawdown versus prior observations.

## Data / method

Repo: `/home/joao/projects/bitcoin-forecast-visualizer`

Data used:

- `src/data/btc-history.json`: 2010-07-17 through 2026-06-11, 5,809 daily rows.
- `src/data/feature-table.json`: 2010-07-18 through 2026-06-11, 5,808 rows.

Eligibility:

- Modern sample starts `2013-01-01`.
- At least 730 prior days required before scoring.
- Candidate entries are de-duplicated with 90d / 180d / 365d cooldowns to reduce overlapping-label inflation.
- Forward return checks use 365d and 730d outcomes where available.

Bottom score:

```text
bottomScore = average(
  1 - prior percentile(priceResidualLog),
  1 - running mvrvPercentile,
  1 - prior percentile(realizedPriceDistance),
  1 - prior percentile(drawdownFromCycleHigh)
)
```

Important sign note: `drawdownFromCycleHigh` is negative, so deeper drawdowns are lower raw values; the score uses `1 - percentile` for drawdown pain.

## Main finding

The first useful candidate is:

```text
Heavy Buy Zone: bottomScore >= 0.70
Max Conviction Heavy Buy: bottomScore >= 0.75
Optional extra filter: drawdownPainPct >= 0.80
```

Interpretation:

- `>= 0.70`: statistically useful broad bottom/accumulation zone.
- `>= 0.75`: rare, high-conviction bottom stress.
- `drawdownPainPct >= 0.80`: useful if we want fewer false positives and stronger “capitulation” semantics.

## Backtest summary

Baseline: one entry every 180 days after 2013.

- n: 26
- 1y median return: +74%
- 2y median return: +180%
- 1y win rate: 73%

Candidate: `bottomScore >= 0.70`, 180d cooldown.

- n: 8
- 1y median return: +98%
- 2y median return: +354%
- 1y win rate: 88%
- 2y win rate: 100%
- median max gain within 1y: +185%
- median worst drawdown next 180d: -28%

Candidate: `bottomScore >= 0.75`, 180d cooldown.

- n: 4
- 1y median return: +116%
- 2y median return: +398%
- 1y win rate: 100%
- 2y win rate: 100%
- median max gain within 1y: +175%
- median worst drawdown next 180d: -21%

Candidate: `bottomScore >= 0.70 && drawdownPainPct >= 0.80`, 180d cooldown.

- n: 6
- 1y median return: +98%
- 2y median return: +333%
- 1y win rate: 100%
- 2y win rate: 100%
- median max gain within 1y: +190%
- median worst drawdown next 180d: -34%

## Sensitivity checks

`bottomScore >= 0.70`:

- 90d cooldown: n=12, 1y median +98%, 1y win 92%, 2y median +354%.
- 180d cooldown: n=8, 1y median +98%, 1y win 88%, 2y median +354%.
- 365d cooldown: n=5, 1y median +79%, 1y win 100%, 2y median +341%.

`bottomScore >= 0.75`:

- 90d cooldown: n=5, 1y median +113%, 1y win 100%, 2y median +413%.
- 180d cooldown: n=4, 1y median +116%, 1y win 100%, 2y median +398%.
- 365d cooldown: n=3, 1y median +113%, 1y win 100%, 2y median +337%.

`bottomScore >= 0.70 && drawdownPainPct >= 0.80`:

- 90d cooldown: n=10, 1y median +98%, 1y win 100%, 2y median +333%.
- 180d cooldown: n=6, 1y median +98%, 1y win 100%, 2y median +333%.
- 365d cooldown: n=4, 1y median +79%, 1y win 100%, 2y median +316%.

## Period splits

`bottomScore >= 0.70`, 180d cooldown:

- 2013–2017: 4 events, 1y median +90%, 1y win 75%, 2y median +311%.
- 2018–2021: 2 events, 1y median +340%, 1y win 100%, 2y median +467%.
- 2022–2026: 2 events, 1y median +77%, 1y win 100%, 2y median +331%.

## Historical zones found

`bottomScore >= 0.70` contiguous zones of at least 7 days:

- 2014-12-17..2014-12-23, 7d, price 320 → 335, low 2014-12-18 @ 310, max score 0.73.
- 2014-12-25..2015-03-11, 77d, price 319 → 296, low 2015-01-14 @ 165, max score 0.82.
- 2015-03-14..2015-06-30, 109d, price 282 → 264, low 2015-04-14 @ 218, max score 0.78.
- 2015-08-09..2015-10-16, 69d, price 264 → 263, low 2015-08-24 @ 211, max score 0.81.
- 2018-12-04..2018-12-20, 17d, price 3,948 → 4,138, low 2018-12-15 @ 3,233, max score 0.78.
- 2018-12-26..2019-01-02, 8d, price 3,849 → 3,961, low 2018-12-27 @ 3,646, max score 0.74.
- 2019-01-11..2019-02-18, 39d, price 3,669 → 3,913, low 2019-02-07 @ 3,375, max score 0.77.
- 2022-06-17..2022-07-07, 21d, price 20,432 → 21,612, low 2022-06-18 @ 18,954, max score 0.74.
- 2022-08-27..2022-09-09, 14d, price 20,038 → 21,370, low 2022-09-06 @ 18,792, max score 0.73.
- 2022-09-14..2022-10-04, 21d, price 20,234 → 20,345, low 2022-09-21 @ 18,468, max score 0.73.
- 2022-10-07..2022-10-25, 19d, price 19,533 → 20,087, low 2022-10-20 @ 19,044, max score 0.72.
- 2022-11-09..2023-01-12, 65d, price 15,820 → 18,849, low 2022-11-21 @ 15,760, max score 0.78.

## Current state as of latest bundled data

Latest data row: `2026-06-11`, close `$63,477.66`.

- `bottomScore`: 0.644
- `residualPctPast`: 0.583
- `mvrvPercentile`: 0.183
- `realizedPctPast`: 0.184
- `drawdownPainPctPast`: 0.524
- `drawdownFromCycleHigh`: -50.9%
- `realizedPriceDistance`: +14.7%
- `priceResidualLog`: -0.243

Conclusion: current flow is cheap/on-chain depressed, but not a heavy buy zone by this score. The blocker is structural price residual: price is not low enough versus the power-law flow/channel history. Holding other inputs constant:

- `bottomScore >= 0.70` would require `residualPctPast <= ~0.358`.
- `bottomScore >= 0.75` would require `residualPctPast <= ~0.158`.

## Verdict

Status: **candidate / likely promote after adding one more leakage-safe report script**.

The signal is not strong enough to call mathematically final because BTC has only a handful of true bottoms. But it is clearly good enough to add as a product experiment behind a conservative label:

- Chart label: `Heavy Buy Zone`
- Stronger inner label: `Max Conviction Buy`
- Copy: `Historically cheap/stressed region based on power-law residual, MVRV, realized-price distance, and drawdown pain. Not a bottom guarantee; historically still allowed 20–35% further drawdown.`

## Next implementation direction

Add a bottom-zone overlay analogous to `Trim`:

- Use continuous background/heatmap intensity from `bottomScore`.
- Start visible buy shading at `0.70`.
- Use stronger opacity / label at `0.75`.
- Add a tooltip with the four component scores so it does not look magical.
- Avoid anchoring this to future-known ATL pivots.

A good UX pairing:

- Existing top: `Trim Zone` near predicted/euphoric peak.
- New bottom: `Heavy Buy Zone` when the live flow shows cheapness + capitulation.

Do not call it `bottom` as a noun. Call it a `buy zone`; the historical median next-180d drawdown was still around -21% to -34% depending on strictness.
