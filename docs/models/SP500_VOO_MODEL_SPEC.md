# S&P 500 (VOO) Forecast Model — Complete Specification

Self-contained dump of the S&P 500 tab's model as implemented in this repo. Everything needed to
re-implement or sandbox it independently: data source, all formulas with exact constants,
the visual mapping of every line, and the known limitations.

Source files this was extracted from:

- `src/lib/marketForecast.ts` — model inputs, channel bounds, stochastic traces, forecast rows, heatmap, probability
- `src/lib/api.ts` — data loading
- `src/lib/forecastPathSeed.ts` — deterministic path seeding
- `src/lib/marketForecastChannel.ts` — **candidate** channel path model (NOT wired into runtime)
- `src/components/chart/dataTransforms.ts`, `src/components/Chart.tsx` — series → colors
- `scripts/update-market-data.mjs` — data ingestion
- `src/lib/sp500CrisisModel.ts` — separate crisis-probability tab (Appendix B)

---

## 1. Data

**Instrument:** VOO (Vanguard S&P 500 ETF) — used as the investable S&P 500 proxy. The model never
touches the index level itself, only the ETF.

**Source:** Yahoo Finance chart endpoint, no API key:

```
https://query1.finance.yahoo.com/v8/finance/chart/VOO
  ?period1=<unix ts of 2010-09-09>&period2=<now>&interval=1d&events=history&includeAdjustedClose=true
```

**First trade date:** `2010-09-09`. Current bundle: ~4,007 daily rows.

**Dividend/split adjustment** — all four OHLC values are put on the adjusted-close scale:

```
adjustment = adjClose_t / close_t          (1 if adjClose_t <= 0)
open_t  = round(open_t  * adjustment, 4)
high_t  = round(high_t  * adjustment, 4)
low_t   = round(low_t   * adjustment, 4)
close_t = round(adjClose_t, 4)
volume_t = round(volume_t)
```

Rows where any of open/high/low/close/adjClose/volume is non-finite, or close <= 0, are dropped.

**Validation applied on ingest** (`isValidRow` + `validateSortedRows`): date matches `YYYY-MM-DD`,
`open > 0`, `high >= max(low, open, close)`, `low <= min(open, close)`, `volume >= 0`, and dates
strictly increasing. Any failure aborts the update and the previous cached file is retained.

**Storage:** `src/data/voo-history.json`, a JSON array of
`{date, open, high, low, close, volume}` sorted ascending. The bundle is imported statically at
build time; at runtime the browser optionally calls `/api/market-data?asset=sp500&since=<latest-7d>`
and merges any rows with `date >= bundleLatestDate` (a colliding date is *replaced*, so late D1
repairs overwrite the bundled row). On any failure it silently falls back to the bundle.

**Notation used below:** `C_t` = adjusted close on row `t`; `n` = number of rows;
`C_0` = the last historical close (forecast origin); index 0 is the oldest row.

---

## 2. Model inputs — drift μ and daily volatility σ

`computeSP500ModelInputs(ohlcv)`.

Log returns over the entire history:

```
r_t = ln(C_t / C_{t-1})            for all t where C_t > 0 and C_{t-1} > 0
```

Windows: `r90` = last 90 returns, `r252` = last 252 returns.

**Long-run 252-day slope:**

```
long252 = ln(C_{n-1} / C_{n-253}) / 252        if n > 252
        = mean(r252)                           otherwise
```

**Expanding equity premium** — the full-history mean daily return, clamped:

```
EP = clamp( mean(r_all), 0.00005, 0.00055 )      # ≈ 1.3% .. 14.7% annualized
```

**Drift** (daily, log space) — note the *negative* weight on the 90-day mean: short-horizon
mean-reversion against 1-year momentum:

```
μ = EP - 0.25 * mean(r90) + 0.25 * mean(r252) + 0.10 * long252
```

μ is **not** clamped for S&P 500 (gold is; see the gold spec).

**Daily volatility** — blended short/long realized vol, sample standard deviation (denominator
`N-1`):

```
vol90  = sd(r90)
vol252 = sd(r252)
σ = max( 0.0001, 0.65 * vol90 + 0.35 * vol252 )
```

μ and σ are the only two parameters that drive every forecast product below.

---

## 3. Structural channel — the blue lower band and the red upper band

`SP500_CHANNEL_CONFIG` / `computeSP500ChannelBounds(ohlcv)`.

```
trendWindowDays       = 126     # ~6 months
residualLookbackDays  = 1260    # ~5 years
lowerResidualQuantile = 0.025
upperResidualQuantile = 0.99    # deliberately asymmetric
minResidualSamples    = 756     # ~3 years
```

**Step 1 — trend (simple rolling mean of close, not a regression):**

```
T_i = (1/126) * Σ_{k=i-125}^{i} C_k        for i >= 125
T_i = null                                  for i < 125
```

**Step 2 — log residual against the trend:**

```
e_i = ln( C_i / T_i )                       where T_i > 0 and C_i > 0
```

**Step 3 — per-bar rolling residual quantiles, strictly causal.** For each index `i` with a valid
trend, take the residual window `e_j` for `j ∈ [max(0, i-1260), i-1)` — note the window **excludes
bar `i` itself**, so the band at bar `i` uses only information available before `i`. Drop nulls and
non-finite values. If fewer than 756 samples remain, the bands are `null` at that bar (so the first
usable band is roughly 126 + 756 ≈ 882 trading days into the history).

```
qL_i = Q(window, 0.025)
qU_i = Q(window, 0.99)
lower_i = T_i * exp(qL_i)          # blue "Lower channel"
upper_i = T_i * exp(qU_i)          # red  "Upper channel"
```

**Quantile `Q` is linearly interpolated** on the sorted window:

```
Q(v, q):  s = sort(v); pos = (len(s) - 1) * clamp(q, 0, 1)
          lo = floor(pos); hi = ceil(pos)
          return s[lo] if lo == hi else s[lo] + (s[hi] - s[lo]) * (pos - lo)
```

Interpretation: this is a **structural reference channel**, not a probabilistic interval. The band
says "over the past 5 years, price sat between the 2.5th and 99th percentile of this distance from
its own 6-month mean". The 0.99 upper quantile means the red line is a near-extreme ceiling while
the blue line is a moderate floor — the asymmetry is intentional and hard-coded.

---

## 4. Forecast rows — everything drawn to the right of the last candle

`processGenericData('sp500', ohlcv, horizon, confidenceZ, modelInputs, channelBounds, supportAwarePrimaryTrace=false, pathPolicy)`.

Let `C_0` = last historical close, `D_0` = last historical date, `H` = horizon in days,
`z` = confidence z-score.

**Horizon options in the UI:** 7, 14, 30, 90, 180 (default), 365, 730, 1825, 3650 days.
**Confidence options:** 95% → `z = 1.96`, 90% → `z = 1.64`, 80% → `z = 1.28`.

> **Calendar-day stepping.** Forecast rows are generated with `addUtcDays(D_0, d)` for
> `d = 1..H`, i.e. every calendar day including weekends and holidays. The horizon is therefore a
> calendar horizon, while μ and σ are estimated per *trading* day. This is a known inconsistency
> (≈252/365 mismatch) that inflates both drift and variance per unit of wall-clock time.

For each day `d = 1..H`:

**4.1 Median forecast line (deterministic, log-linear):**

```
median_d = C_0 * exp(μ * d)
```

**4.2 Green dotted confidence band (GBM quantiles):**

```
σ_d           = σ * sqrt(d)
forecastLower = median_d * exp(-z * σ_d)
forecastUpper = median_d * exp(+z * σ_d)
```

**4.3 Synthetic forecast candles** (the ghost candles under the forecast):

```
prevMedian = C_0                     if d == 1
           = C_0 * exp(μ * (d-1))    otherwise
open  = prevMedian
close = median_d
spread = max(0.001, σ * 0.25)
high  = max(open, close) * (1 + spread)
low   = min(open, close) * (1 - spread)
volume = 0
```

Note: what is actually *rendered* as forecast candles is rebuilt in the chart layer from the
primary stochastic trace (§6), not from these values; these OHLC fields are the fallback when no
trace exists.

**4.4 Projected channel (the future part of the blue/red bands).** Take `latestChannel` = the most
recent historical bar whose `lowerResidual`/`upperResidual` are non-null (scan the channel array in
reverse), with trend `T*`, residuals `qL*`, `qU*`. Then:

```
channelTrend_d = T* * exp(μ * d)
lower_d        = channelTrend_d * exp(qL*)
upper_d        = channelTrend_d * exp(qU*)
```

Because the residual quantiles are **frozen** at the origin and the trend compounds one constant
drift, the projected bands are exactly straight lines on a log price scale with constant log-width:

```
ln(bound_d) = ln(T*) + μ*d + frozenResidualQuantile
```

This is the documented cosmetic/statistical defect described in
`docs/PRDs/MARKET_FORECAST_CHANNEL_PATHS.md`. A curved replacement exists but is not deployed —
see Appendix A.

Also note the projected trend anchors on `T*` (the 126-day mean, which lags spot), **not** on
`C_0`. The channel and the median line therefore start from different levels at day 1.

---

## 5. The yellow lines — there are three different amber series

Do not conflate them. All three are amber/`#fbbf24`; only opacity and width differ.

| Series | Data field | Color | Width | What it is |
|---|---|---|---|---|
| Forecast median | row `close` on forecast rows | `rgba(251,191,36,0.95)` | 3 | The smooth `C_0 * exp(μd)` line from §4.1 |
| Primary stochastic trace | `stochasticTraces[0]` | `rgba(251,191,36,0.55)` | 2 | The jagged "yellow path" users mean (§6) |
| Model/trend line | `powerLawModel` = channel trend `T_i` | `rgba(251,191,36,0.8)` | 1 | The 126-day rolling mean (§3 step 1); hidden by default |
| Other 11 traces | `stochasticTraces[1..11]` | `rgba(251,191,36,0.22)` | 1 | Scenario fan (§6) |

Other series for completeness:

| Series | Field | Color |
|---|---|---|
| Lower channel (bottom band) | `floorPriceModel` | `rgba(96,165,250,0.9)` blue, dotted, 2px |
| Upper channel (top band) | `peakPriceModel` | `rgba(239,68,68,0.9)` red, dotted, 2px |
| Confidence band | `forecastUpper` / `forecastLower` | `rgba(16,185,129,0.5)` green, dotted, 1px |
| SMA20 / SMA50 | `sma20` / `sma50` | `#60a5fa` / `#c084fc`, 2px |

`sma20`/`sma50` are plain trailing means of close over 20 and 50 bars, historical rows only.

The field names `powerLawModel` / `floorPriceModel` / `peakPriceModel` are legacy from the Bitcoin
power-law model; for S&P 500 they carry the moving-average channel values, no power law is involved.

---

## 6. Stochastic scenario traces (the jagged yellow path)

`generateGenericStochasticTraces(...)`. 12 traces (`GENERIC_STOCHASTIC_TRACE_COUNT = 12`).

**Innovation pool — centered, vol-rescaled empirical returns:**

```
recent      = last 504 finite log returns              # GENERIC_RETURN_BOOTSTRAP_LOOKBACK_DAYS
if len(recent) < 40:  innovations = []                 # 4 * block length
centered    = recent - mean(recent)
empVol      = sd(centered)                             # sample sd, N-1
if empVol <= 0 or non-finite: innovations = []
innovations = centered * (σ / empVol)                  # rescaled to the model's σ
```

**Path recursion.** Each trace starts at `C_0` on date `D_0`, then for `d = 1..H`:

```
price *= exp( μ - σ²/2 + innovation )
```

with `innovation` drawn by a **10-day moving-block bootstrap**
(`GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS = 10`): when the current block is exhausted, draw a new
block start `floor(rng() * max(1, len(innovations) - 10))` and consume 10 consecutive innovations
from there. If the innovation pool is empty, fall back to `innovation = σ * N(0,1)`, where the
normal is Box–Muller from the same RNG:

```
N(0,1) = sqrt(-2 * ln(max(u1, 1e-12))) * cos(2π * u2)
```

Note the `-σ²/2` Itô correction is applied **on top of** the empirical innovations, so the
bootstrapped traces have median drift slightly below the deterministic median line of §4.1.

**RNG:** mulberry32.

```
mulberry32(seed): t = seed += 0x6D2B79F5
                  t = imul(t ^ (t >>> 15), t | 1)
                  t ^= t + imul(t ^ (t >>> 7), t | 61)
                  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
```

**Seeding depends on `pathPolicy`:**

- `production-baseline` (default, what ships): a single RNG shared by all 12 traces,
  `mulberry32(0x5A500 + H * 97 + n)`. Because the horizon is in the seed, **changing the horizon
  redraws the entire already-visible yellow path**. This is the defect documented in
  `docs/PRDs/YELLOW_LINE_HORIZON_PREFIX_STABILITY.md`.
- `prefix-stable-v1` (gated, not default): one RNG per trace seeded by
  `forecastPathSeed({assetId, originDate, dataVersion, methodId:'generic-return-block-bootstrap-10d', generatorVersion:'prefix-stable-v1'}, traceIndex)`,
  an FNV-1a hash of those fields joined by `|`. The horizon is deliberately excluded, so
  `path(origin, 180d)[1..90] == path(origin, 90d)[1..90]`. `dataVersion` is
  `"<rowCount>-<fnv1a hex of 'date:close;' over all rows>"`.

**S&P 500 passes `supportAwarePrimaryTrace = false`**, so trace 0 is simply the first generated
trace — no reselection, and no lower-bound bounce logic. (Gold uses `true`; see the gold spec.)

---

## 7. Probability forecast (the summary card)

`computeGenericProbabilityForecast(ohlcv, H, {μ, σ}, 'Log-return interval')`. Returns `null` if
`n < 252` or `H < 1`.

```
targetDate = D_0 + H calendar days
median     = C_0 * exp(μ * H)
σ_H        = σ * sqrt(H)
q05 = median * exp(-1.6448536269514722 * σ_H)
q10 = median * exp(-1.2815515655446004 * σ_H)
q90 = median * exp(+1.2815515655446004 * σ_H)
q95 = median * exp(+1.6448536269514722 * σ_H)

zUp           = ln(C_0 / median) / max(σ_H, 1e-9)
probabilityUp = clamp(1 - Φ(zUp), 0.01, 0.99)          # P(price_H > today's price)

verdict = 'Upside-biased scenario'   if probabilityUp > 0.57
        = 'Downside-biased scenario' if probabilityUp < 0.43
        = 'Balanced distribution'    otherwise
```

`Φ` is the Zelen & Severo 26.2.17 rational approximation (abs error ≈ 7.5e-8):

```
t = 1 / (1 + 0.2316419*|x|)
d = 0.3989423 * exp(-x²/2)
p = d*t*(0.3193815 + t*(-0.3565638 + t*(1.781478 + t*(-1.821256 + t*1.330274))))
Φ(x) = 1 - p  if x > 0 else p
```

Note `zUp` simplifies to `-μH / (σ√H)`, so `probabilityUp` depends only on μ, σ, H — never on the
current level relative to the channel.

---

## 8. Density heatmap

`generateGenericHeatmapData(ohlcv, H, {μ, σ}, numSimulations=500, numPriceBands=80)`.

Pure Gaussian GBM, no bootstrap:

```
rng   = mulberry32(0x500500 + H*53 + n)
price = C_0;  price *= exp(μ - σ²/2 + σ * N(0,1))   for each day 1..H
```

Sampling stride to bound output size:

```
sampleStep = 1  if H <= 90
           = 2  if H <= 365
           = 5  if H <= 1825
           = 10 otherwise
sampled days = {1, H} ∪ {d : d mod sampleStep == 0}
```

Banding: pool **all** simulated prices across all sampled days, take `p05` and `p95` (nearest-rank,
`index = floor(q*(len-1))`), then split `[ln p05, ln p95]` into 80 equal log-width bands. Per
sampled date, count simulations per band and emit
`{date, priceLow, priceHigh, density = count / maxCountThatDate}`. Bands with zero count are
skipped; if `bandSize` is non-finite or `<= 0` the whole heatmap is empty.

---

## 9. Reference pseudocode (end to end)

```python
rows = load_voo_history()                      # adjusted daily OHLCV, ascending

# --- inputs ---
r        = [log(rows[i].close / rows[i-1].close) for i in 1..n-1]
EP       = clamp(mean(r), 5e-5, 5.5e-4)
long252  = log(rows[-1].close / rows[-253].close)/252 if n > 252 else mean(r[-252:])
mu       = EP - 0.25*mean(r[-90:]) + 0.25*mean(r[-252:]) + 0.10*long252
sigma    = max(1e-4, 0.65*sd(r[-90:]) + 0.35*sd(r[-252:]))

# --- channel ---
T = rolling_mean(close, 126)                   # None before index 125
e = [log(c/t) if t else None for c, t in zip(close, T)]
for i in range(n):
    win = [x for x in e[max(0, i-1260):i] if x is not None]
    if T[i] is None or len(win) < 756: lower[i] = upper[i] = None; continue
    qL, qU   = interp_quantile(win, 0.025), interp_quantile(win, 0.99)
    lower[i] = T[i]*exp(qL);  upper[i] = T[i]*exp(qU)

# --- forecast ---
C0 = close[-1]; T_star, qL_star, qU_star = last_valid_channel(T, e)
for d in 1..H:
    date    = D0 + d days                       # calendar days
    median  = C0*exp(mu*d)
    lo_ci   = median*exp(-z*sigma*sqrt(d));  hi_ci = median*exp(+z*sigma*sqrt(d))
    trend_d = T_star*exp(mu*d)
    lower_d = trend_d*exp(qL_star);          upper_d = trend_d*exp(qU_star)

# --- 12 yellow traces ---
inn = center(r[-504:]); inn = inn * (sigma / sd(inn))
for trace in 1..12:
    p = C0
    for d in 1..H:
        p *= exp(mu - sigma**2/2 + block_bootstrap_draw(inn, block=10, rng))
```

---

## 10. Known limitations (be explicit about these when reworking the model)

1. **Calendar vs trading days.** Forecast rows step by calendar day while μ/σ are per trading day.
   Anything past a few weeks is drifted and widened by roughly a factor 365/252 in day count.
2. **Straight projected bands.** Frozen residual quantiles + constant drift ⇒ zero curvature and
   constant log-width for the blue/red bands in the future region. Statistically the band carries
   no horizon-dependent uncertainty at all.
3. **Horizon-dependent yellow path** under the shipped `production-baseline` policy: changing the
   horizon rewrites the visible prefix. The fix (`prefix-stable-v1`) exists and is tested but is
   not the default.
4. **Asymmetric channel quantiles** (0.025 vs 0.99) mean the two bands are not comparable —
   the upper band is a near-max envelope, the lower is a mild floor.
5. **Trend anchor mismatch:** the projected channel starts from the 126-day mean `T*`, the median
   line starts from spot `C_0`. They can be far apart when the market has moved fast.
6. **Two Itô corrections in play.** The deterministic median uses `exp(μd)` (no `-σ²/2`), while the
   traces and heatmap use `exp(μ - σ²/2)`. The traces are therefore systematically below the yellow
   median line in expectation. Whether the median is meant to be the mean or the median of the
   simulated distribution is unresolved.
7. **No regime, macro, valuation or rate input.** μ is pure return momentum/mean-reversion; σ is
   pure realized vol. There is no GARCH, no fat tails beyond what the 504-day bootstrap pool
   contains, no earnings or discount-rate term.
8. **Drift is unclamped for S&P 500.** A violent 90-day move can push μ well outside anything
   plausible for a broad index (gold clamps at ±0.0006/day, S&P does not).
9. **VOO ≠ S&P 500 index.** Total-return-adjusted ETF prices, subject to expense ratio and
   tracking differences; history starts 2010-09-09, so no 2008 crisis in the residual pool.

---

## Appendix A — the unwired candidate channel model

`src/lib/marketForecastChannel.ts` implements a curved, simulation-based replacement for §4.4.
It is called only from `scripts/backtest-market-channel-path.ts`; **the runtime never uses it.**

```
MARKET_CHANNEL_CANDIDATE_CONFIG = {
  methodId: 'moving-block-price-quantiles-v1',
  configurationVersion: 'market-channel-path-v1',
  simulations: 1000, blockLength: 10, innovationLookback: 504,
  lowerQuantile: 0.05, upperQuantile: 0.95, minimumRows: 1000,
}
```

Method: 1,000 moving-block-bootstrap price paths (identical recursion to §6, but stepping over
**US market session days** via `isUsMarketSessionDay`, not calendar days), then per forecast date:

```
median_d = C_0 * exp(μ * d)
lower_d  = min(median_d, quantile(prices_d, 0.05))
upper_d  = max(median_d, quantile(prices_d, 0.95))
```

Falls back to the frozen-residual baseline on: empty input, `< 1000` rows, `< 40` innovations,
invalid vol, or any invariant failure (non-finite, `lower <= 0`, `lower > upper`, non-monotone dates).

**Gate result (`docs/reports/results/market-channel-path-candidates-2026-07-10.md`): verdict
`needs-more-data` — NOT promoted.** Coverage improved markedly at long leads (S&P 180d: baseline
41.7% → candidate 94.4%) but the Bonferroni-corrected p-values at 60/90/120-day leads
(0.18, 0.18, 0.525) failed the pre-registered gate with only 36–48 overlapping origins.

---

## Appendix B — the S&P 500 Crisis tab (separate model, imported snapshot)

The third tab (`sp500-crisis`) shares the VOO price data but its probability pane comes from a
**frozen JSON snapshot**, not from any formula in this codebase:
`src/data/sp500-crisis-model.json`, validated by `src/lib/sp500CrisisModel.ts`.

- Runtime mode is hard-validated as `shadow` / `context-only` / `not-promoted` — the loader throws
  if the snapshot claims otherwise. It never feeds the price forecast.
- Fields: `currentScore` (raw, incumbent, challenger-evaluation, challenger-deployment
  probabilities, drawdown, S&P close, VIX), `deploymentThresholds` and `lockedThresholds`
  (`watch < high`), plus a full out-of-sample history.
- Zone classification is the only live computation:
  `HIGH if p >= high; WATCH if p >= watch; NORMAL otherwise`, applied to
  `challengerDeploymentProbability` against `deploymentThresholds`. The snapshot's own `riskZone`
  must agree or loading fails.
- `isStale = quoteDate > currentScore.asOfDate`.

If you are reworking the price model, this tab is out of scope — it has no shared parameters.
