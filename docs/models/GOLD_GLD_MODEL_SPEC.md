# Gold (GLD) Forecast Model — Complete Specification

Self-contained dump of the Gold tab's model as implemented in this repo. Companion to
`SP500_VOO_MODEL_SPEC.md` — gold and S&P 500 share the same generic pipeline and differ only in
(a) the drift/vol estimator, (b) the channel trend window, and (c) gold enabling the
support-aware primary-trace logic. Differences are flagged **[GOLD-ONLY]** throughout.

Source files: `src/lib/marketForecast.ts`, `src/lib/api.ts`, `src/lib/forecastPathSeed.ts`,
`src/lib/marketForecastChannel.ts` (unwired candidate), `src/components/Chart.tsx`,
`src/components/chart/dataTransforms.ts`, `scripts/update-market-data.mjs`.

---

## 1. Data

**Instrument:** GLD (SPDR Gold Shares) — used as the investable gold proxy. The model never touches
the spot gold fix; it forecasts the ETF's adjusted price.

**Source:** Yahoo Finance chart endpoint, no API key:

```
https://query1.finance.yahoo.com/v8/finance/chart/GLD
  ?period1=<unix ts of 2004-11-18>&period2=<now>&interval=1d&events=history&includeAdjustedClose=true
```

**First trade date:** `2004-11-18` (≈6 years more history than VOO, and it includes 2008).

**Adjustment, validation and storage** are identical to the S&P 500 pipeline:

```
adjustment = adjClose_t / close_t          (1 if adjClose_t <= 0)
open/high/low = round(raw * adjustment, 4)
close         = round(adjClose_t, 4)
volume        = round(volume_t)
```

Rows with any non-finite OHLC/adjClose/volume or `close <= 0` are dropped. `isValidRow` +
`validateSortedRows` enforce `open > 0`, `high >= max(low, open, close)`,
`low <= min(open, close)`, `volume >= 0`, strictly increasing dates; a failure keeps the previous
cached file.

**Storage:** `src/data/gld-history.json`, ascending array of `{date, open, high, low, close, volume}`.
The static bundle is optionally topped up at runtime via
`/api/market-data?asset=gold&since=<latest-7d>`, merging rows with `date >= bundleLatestDate`
(colliding dates are replaced by the remote row), silently falling back to the bundle on error.

**Notation:** `C_t` = adjusted close, `n` = row count, `C_0` = last historical close (forecast
origin), `D_0` = last historical date, `H` = horizon in days.

---

## 2. Model inputs — drift μ and daily volatility σ **[GOLD-ONLY estimator]**

`computeGoldModelInputs(ohlcv)` with `GOLD_MOMENTUM_CONFIG`:

```
shortMomentumDays   = 252
longMomentumDays    = 504
shortMomentumWeight = 0.25
longMomentumWeight  = 0.25
maxDailyDrift       = 0.0006          # ≈ ±16.3% annualized (252d)
volatilityWindowDays = 252
```

Gold has **no equity-premium term and no short-horizon mean-reversion term**. Drift is pure slow
momentum, and unlike S&P 500 it is hard-clamped.

**Per-day momentum over a lookback of `k` days** (0 if `n <= k` or the anchor close is not positive):

```
mom(k) = ln( C_{n-1} / C_{n-1-k} ) / k
```

**Drift:**

```
rawDrift = 0.25 * mom(252) + 0.25 * mom(504)
μ        = clamp(rawDrift, -0.0006, +0.0006)
```

The weights sum to 0.5, so μ is roughly half the blended annualized trend before clamping.

**Daily volatility** — single-window realized vol with a wider fallback, sample sd (denominator
`N-1`), no short/long blend:

```
w = last 252 log returns          if len(last 252) >= 60
  = last min(n, 756) log returns  otherwise
σ = max(0.0001, sd(w))
```

Log returns are the same as everywhere: `r_t = ln(C_t / C_{t-1})` for positive consecutive closes.

μ and σ drive every product below.

---

## 3. Structural channel — the blue lower band and the red upper band

`GOLD_CHANNEL_CONFIG` / `computeGoldChannelBounds(ohlcv)`. Identical algorithm to S&P 500; the only
changed constant is the trend window (252 vs 126) **[GOLD-ONLY]**:

```
trendWindowDays       = 252     # ~12 months (S&P uses 126)
residualLookbackDays  = 1260    # ~5 years
lowerResidualQuantile = 0.025
upperResidualQuantile = 0.99    # deliberately asymmetric
minResidualSamples    = 756     # ~3 years
```

**Step 1 — trend (rolling arithmetic mean of close, not a regression):**

```
T_i = (1/252) * Σ_{k=i-251}^{i} C_k     for i >= 251
T_i = null                               for i < 251
```

**Step 2 — log residual:**

```
e_i = ln( C_i / T_i )                    where T_i > 0 and C_i > 0
```

**Step 3 — causal rolling residual quantiles.** For each index `i` with a valid trend, use residuals
`e_j` for `j ∈ [max(0, i-1260), i-1)` — **excluding bar `i` itself**. Drop nulls/non-finite. If
fewer than 756 samples remain, bands are `null` at that bar (first usable band ≈ 252 + 756 ≈ 1008
trading days in).

```
qL_i = Q(window, 0.025)
qU_i = Q(window, 0.99)
lower_i = T_i * exp(qL_i)          # blue "Lower channel"
upper_i = T_i * exp(qU_i)          # red  "Upper channel"
```

`Q` is linearly interpolated:

```
Q(v, q):  s = sort(v); pos = (len(s)-1) * clamp(q, 0, 1)
          lo = floor(pos); hi = ceil(pos)
          return s[lo] if lo == hi else s[lo] + (s[hi]-s[lo]) * (pos-lo)
```

This is a **structural reference channel**, not a probabilistic interval: how far price sits from
its own 12-month mean, relative to the past 5 years of that same distance. The 0.99 upper quantile
makes the red line a near-extreme ceiling while the blue line at 0.025 is a mild floor.

---

## 4. Forecast rows

`processGenericData('gold', ohlcv, H, z, modelInputs, channelBounds, supportAwarePrimaryTrace=true, pathPolicy)`.

**Horizon options:** 7, 14, 30, 90, 180 (default), 365, 730, 1825, 3650 days.
**Confidence:** 95% → `z = 1.96`, 90% → `z = 1.64`, 80% → `z = 1.28`.

> **Calendar-day stepping.** Rows step `addUtcDays(D_0, d)` for `d = 1..H` — every calendar day
> including weekends and holidays — while μ and σ are per *trading* day. Known inconsistency
> (≈365/252 over-extension in day count).

For each `d = 1..H`:

**4.1 Median forecast line:**

```
median_d = C_0 * exp(μ * d)
```

**4.2 Green dotted confidence band:**

```
σ_d           = σ * sqrt(d)
forecastLower = median_d * exp(-z * σ_d)
forecastUpper = median_d * exp(+z * σ_d)
```

**4.3 Synthetic forecast candles:**

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

The rendered forecast candles are rebuilt in the chart layer from the primary stochastic trace
(§6) — these OHLC values are the fallback path when no trace exists.

**4.4 Projected channel.** Take `latestChannel` = the most recent historical bar with non-null
residuals (reverse scan): trend `T*`, residuals `qL*`, `qU*`.

```
channelTrend_d = T* * exp(μ * d)
lower_d        = channelTrend_d * exp(qL*)
upper_d        = channelTrend_d * exp(qU*)
```

Frozen quantiles + constant drift ⇒ the future bands are exactly straight on a log scale with
constant log-width:

```
ln(bound_d) = ln(T*) + μ*d + frozenResidualQuantile
```

Documented defect (`docs/PRDs/MARKET_FORECAST_CHANNEL_PATHS.md`); the curved replacement is not
deployed — Appendix A. Note also the projected channel anchors on `T*` (a 252-day mean, which lags
spot heavily for gold) while the median line anchors on `C_0`; at day 1 they can be far apart.

---

## 5. Series → colors (which line is which)

Three distinct amber series exist. They are all `#fbbf24`; opacity and width differ.

| Series | Data field | Color | Width | What it is |
|---|---|---|---|---|
| Forecast median | forecast row `close` | `rgba(251,191,36,0.95)` | 3 | Smooth `C_0 * exp(μd)` (§4.1) |
| Primary stochastic trace | `stochasticTraces[0]` | `rgba(251,191,36,0.55)` | 2 | The jagged "yellow path" (§6) |
| Model/trend line | `powerLawModel` = channel trend `T_i` | `rgba(251,191,36,0.8)` | 1 | 252-day rolling mean; hidden by default |
| Scenario fan | `stochasticTraces[1..11]` | `rgba(251,191,36,0.22)` | 1 | 11 remaining traces |
| Lower channel (bottom band) | `floorPriceModel` | `rgba(96,165,250,0.9)` blue, dotted | 2 | §3 / §4.4 |
| Upper channel (top band) | `peakPriceModel` | `rgba(239,68,68,0.9)` red, dotted | 2 | §3 / §4.4 |
| Confidence band | `forecastUpper` / `forecastLower` | `rgba(16,185,129,0.5)` green, dotted | 1 | §4.2 |
| SMA20 / SMA50 | `sma20` / `sma50` | `#60a5fa` / `#c084fc` | 2 | trailing means of close, historical only |

Field names `powerLawModel` / `floorPriceModel` / `peakPriceModel` are legacy from the Bitcoin
power-law model. For gold they hold moving-average channel values; no power law is involved.

---

## 6. Stochastic scenario traces (the jagged yellow path)

`generateGenericStochasticTraces(...)`. 12 traces (`GENERIC_STOCHASTIC_TRACE_COUNT = 12`).

**Innovation pool:**

```
recent      = last 504 finite log returns     # GENERIC_RETURN_BOOTSTRAP_LOOKBACK_DAYS
if len(recent) < 40:  innovations = []        # 4 * block length
centered    = recent - mean(recent)
empVol      = sd(centered)                    # sample sd, N-1
if empVol <= 0 or non-finite: innovations = []
innovations = centered * (σ / empVol)         # rescaled to the model's σ
```

**Path recursion.** Each trace starts at `C_0` on `D_0`; for `d = 1..H`:

```
price *= exp( μ - σ²/2 + innovation )
```

`innovation` comes from a **10-day moving-block bootstrap**: when the block is exhausted, draw a
new block start `floor(rng() * max(1, len(innovations) - 10))` and consume 10 consecutive values.
With an empty pool, `innovation = σ * N(0,1)` via Box–Muller:

```
N(0,1) = sqrt(-2 * ln(max(u1, 1e-12))) * cos(2π * u2)
```

The `-σ²/2` Itô correction is applied on top of the empirical innovations, so trace medians sit
slightly below the deterministic median line of §4.1.

**RNG — mulberry32:**

```
mulberry32(seed): t = seed += 0x6D2B79F5
                  t = imul(t ^ (t >>> 15), t | 1)
                  t ^= t + imul(t ^ (t >>> 7), t | 61)
                  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
```

**Seeding by `pathPolicy`:**

- `production-baseline` (ships): one shared RNG, `mulberry32(0x5A500 + H*97 + n)`. The horizon is
  in the seed, so changing the horizon redraws the whole visible yellow path
  (`docs/PRDs/YELLOW_LINE_HORIZON_PREFIX_STABILITY.md`).
- `prefix-stable-v1` (gated): one RNG per trace seeded with
  `forecastPathSeed({assetId:'gold', originDate, dataVersion, methodId:'generic-return-block-bootstrap-10d', generatorVersion:'prefix-stable-v1'}, traceIndex)`
  — FNV-1a over those fields joined by `|`, horizon deliberately excluded, so
  `path(origin, 180d)[1..90] == path(origin, 90d)[1..90]`. `dataVersion` is
  `"<rowCount>-<fnv1a hex of 'date:close;' over all rows>"`.

---

## 7. **[GOLD-ONLY]** Support-aware primary trace

Gold passes `supportAwarePrimaryTrace = true`; S&P 500 passes `false`. Two extra steps run over the
forecast rows.

### 7.1 Primary-trace selection (`selectPrimaryTraceIndex`)

Score each of the 12 traces over the scored rows and keep the lowest score:

```
valid rows = forecast rows where trace value, floorPriceModel and close are all finite

breachRate       = count(trace_i < floorPriceModel) / len(valid)
avgMedianDist    = mean( |ln(trace_i / row.close)| )        # row.close == the §4.1 median
firstDistance    = |ln(trace_i / close)| on the first valid row
terminalDistance = |ln(trace_i / close)| on the last valid row

score = avgMedianDist + 0.2*breachRate + 0.8*firstDistance + 0.25*terminalDistance
```

The chosen trace is moved to index 0 and the rest keep their relative order. Selection favours
paths that hug the median, start close to the origin, and rarely breach the lower channel.

**Selection window differs by policy:**

- `production-baseline` (ships): `selectionWindowDays = +Infinity` — scored over **all** forecast
  rows, so a longer horizon can pick a different trace and rewrite the already-visible prefix.
- `prefix-stable-v1`: scored over the first **14** forecast rows only, a window present at every
  supported horizon, which makes the choice horizon-independent. The chosen index is also written
  back to each forecast row as `primaryTraceIndex`.

### 7.2 Lower-bound bounce (`projectTraceAboveLowerBound`)

The promoted trace is re-integrated from its own log returns and pushed above the blue lower
channel wherever it would dip below it. Walking forward with `previousRaw`/`previousProjected`
initialised to `C_0`:

```
rawReturn      = ln(rawPrimary_d / previousRaw)        # 0 if either is non-positive/non-finite
proposed       = previousProjected * exp(rawReturn)

L = floorPriceModel_d;  buffer = 1.002
if L is null/<=0 or proposed >= L*buffer:
    primary_d = proposed
else:
    downsideGap = max(0, ln(L / proposed))
    bounce      = min( ln(1.04), ln(1.002) + 0.35 * downsideGap )
    primary_d   = L * exp(bounce)                      # 0.2% .. 4% above the lower band
```

Effect: the gold yellow path treats the blue lower channel as **support** — it can approach it but
is deflected back up, capped at 4% above the band. This is a cosmetic/behavioural override with no
statistical justification, and it means the primary trace is **not** a draw from the same
distribution as the other 11 traces. Do not use `stochasticTraces[0]` for gold in any probability
calculation.

---

## 8. Probability forecast (summary card)

`computeGenericProbabilityForecast(ohlcv, H, {μ, σ}, 'Slow momentum interval')` — the only
difference from S&P 500 is the label **[GOLD-ONLY]**. Returns `null` if `n < 252` or `H < 1`.

```
targetDate = D_0 + H calendar days
median     = C_0 * exp(μ * H)
σ_H        = σ * sqrt(H)
q05 = median * exp(-1.6448536269514722 * σ_H)
q10 = median * exp(-1.2815515655446004 * σ_H)
q90 = median * exp(+1.2815515655446004 * σ_H)
q95 = median * exp(+1.6448536269514722 * σ_H)

zUp           = ln(C_0 / median) / max(σ_H, 1e-9)      # == -μH / (σ√H)
probabilityUp = clamp(1 - Φ(zUp), 0.01, 0.99)

verdict = 'Upside-biased scenario'   if probabilityUp > 0.57
        = 'Downside-biased scenario' if probabilityUp < 0.43
        = 'Balanced distribution'    otherwise
```

`Φ` is the Zelen & Severo 26.2.17 rational approximation:

```
t = 1 / (1 + 0.2316419*|x|)
d = 0.3989423 * exp(-x²/2)
p = d*t*(0.3193815 + t*(-0.3565638 + t*(1.781478 + t*(-1.821256 + t*1.330274))))
Φ(x) = 1 - p  if x > 0 else p
```

Because gold's μ is clamped to ±0.0006, `probabilityUp` is bounded: at H=180 with σ≈0.009 it cannot
exceed roughly 0.81 or fall below roughly 0.19.

---

## 9. Density heatmap

`generateGenericHeatmapData(ohlcv, H, {μ, σ}, numSimulations=500, numPriceBands=80)` — shared with
S&P 500, pure Gaussian GBM (no bootstrap):

```
rng   = mulberry32(0x500500 + H*53 + n)
price = C_0;  price *= exp(μ - σ²/2 + σ*N(0,1))    for each day 1..H

sampleStep = 1 (H<=90) | 2 (H<=365) | 5 (H<=1825) | 10 otherwise
sampled days = {1, H} ∪ {d : d mod sampleStep == 0}
```

Banding: pool all simulated prices across all sampled days, take `p05`/`p95` by nearest rank
(`index = floor(q*(len-1))`), split `[ln p05, ln p95]` into 80 equal log-width bands, then per
sampled date emit `{date, priceLow, priceHigh, density = count / maxCountThatDate}`. Empty bands are
skipped; a non-finite or non-positive band size yields an empty heatmap.

---

## 10. Reference pseudocode (end to end)

```python
rows = load_gld_history()                      # adjusted daily OHLCV, ascending

# --- inputs (GOLD) ---
r   = [log(rows[i].close/rows[i-1].close) for i in 1..n-1]
mom = lambda k: log(rows[-1].close / rows[-1-k].close)/k if n > k else 0.0
mu  = clamp(0.25*mom(252) + 0.25*mom(504), -0.0006, 0.0006)
w   = r[-252:] if len(r[-252:]) >= 60 else r[-min(len(r), 756):]
sigma = max(1e-4, sd(w))

# --- channel (252-day trend) ---
T = rolling_mean(close, 252)
e = [log(c/t) if t else None for c, t in zip(close, T)]
for i in range(n):
    win = [x for x in e[max(0, i-1260):i] if x is not None]
    if T[i] is None or len(win) < 756: lower[i] = upper[i] = None; continue
    qL, qU   = interp_quantile(win, 0.025), interp_quantile(win, 0.99)
    lower[i] = T[i]*exp(qL);  upper[i] = T[i]*exp(qU)

# --- forecast ---
C0 = close[-1]; T_star, qL_star, qU_star = last_valid_channel(T, e)
for d in 1..H:                                  # calendar days
    median  = C0*exp(mu*d)
    lo_ci   = median*exp(-z*sigma*sqrt(d));  hi_ci = median*exp(+z*sigma*sqrt(d))
    trend_d = T_star*exp(mu*d)
    lower_d = trend_d*exp(qL_star);          upper_d = trend_d*exp(qU_star)

# --- 12 traces, then GOLD-ONLY promotion + support bounce ---
inn = center(r[-504:]); inn = inn * (sigma / sd(inn))
traces = [block_bootstrap_path(C0, mu, sigma, inn, block=10, H, rng) for _ in range(12)]
k = argmin_score(traces)                        # §7.1, full horizon in production-baseline
primary = reintegrate_and_bounce(traces[k], lower_d)   # §7.2
```

---

## 11. Known limitations

1. **Support bounce is not a forecast.** §7.2 deflects the primary trace off the lower channel with
   a hand-tuned 0.2%–4% rule. `stochasticTraces[0]` is therefore biased upward and is not a valid
   sample from the model's distribution.
2. **Primary-trace reselection under `production-baseline`** scores over the whole requested
   horizon, so extending the horizon can swap the chosen trace and rewrite the visible prefix — on
   top of the horizon-in-seed redraw that S&P 500 also has.
3. **Calendar vs trading days.** Forecast rows step by calendar day; μ/σ are per trading day.
4. **Straight projected bands.** Frozen residual quantiles + constant drift ⇒ zero curvature and
   constant log-width in the future region; the band carries no horizon-dependent uncertainty.
5. **Asymmetric channel quantiles** (0.025 vs 0.99): the red band is a near-max envelope, the blue
   band a mild floor. They are not symmetric counterparts.
6. **Anchor mismatch:** projected channel from the 252-day mean `T*`, median line from spot `C_0`.
   For gold's long trend window this gap can be large after a fast move.
7. **Drift clamp dominates.** After a strong year, `rawDrift` regularly exceeds 0.0006/day, so μ is
   pinned at the cap and every horizon returns the same annualized slope regardless of how strong
   the momentum actually was.
8. **No real-rate, USD or CPI input.** μ is pure price momentum; σ is pure realized vol. Gold's
   dominant macro drivers are absent from the model entirely.
9. **Two Itô conventions.** The median line uses `exp(μd)` while traces and heatmap use
   `exp(μ - σ²/2)`, so the simulated cloud sits systematically below the yellow median line.
10. **GLD ≠ spot gold.** ETF price net of expense ratio and vaulting costs, and the model's history
    starts 2004-11-18, so the entire pre-2004 gold regime is outside the residual pool.

---

## Appendix A — the unwired candidate channel model

`src/lib/marketForecastChannel.ts` implements a curved, simulation-based replacement for §4.4. It
is invoked only from `scripts/backtest-market-channel-path.ts`; **the runtime never calls it.**

```
MARKET_CHANNEL_CANDIDATE_CONFIG = {
  methodId: 'moving-block-price-quantiles-v1',
  configurationVersion: 'market-channel-path-v1',
  simulations: 1000, blockLength: 10, innovationLookback: 504,
  lowerQuantile: 0.05, upperQuantile: 0.95, minimumRows: 1000,
}
```

1,000 moving-block-bootstrap price paths (same recursion as §6, but stepping over **US market
session days** via `isUsMarketSessionDay`, not calendar days), then per forecast date:

```
median_d = C_0 * exp(μ * d)
lower_d  = min(median_d, quantile(prices_d, 0.05))
upper_d  = max(median_d, quantile(prices_d, 0.95))
```

Falls back to the frozen-residual baseline on empty input, `< 1000` rows, `< 40` innovations,
invalid vol, or any invariant failure (non-finite, `lower <= 0`, `lower > upper`, non-monotone dates).

**Gate result (`docs/reports/results/market-channel-path-candidates-2026-07-10.md`): verdict
`needs-more-data` — NOT promoted.** Gold coverage improved at long leads (180d: baseline 46.9% →
candidate 77.6%; interval score −55.2%), but the Bonferroni-corrected p-values at 90 and 120-day
leads (0.141, 0.147) failed the pre-registered gate on 49–65 overlapping origins, and short-lead
coverage got slightly worse (5d: 93.8% → 86.2%).

---

## Appendix B — what gold shares with the S&P 500 model

Identical code paths, so a fix in one applies to both:

| Component | Shared? |
|---|---|
| Data ingestion / adjustment / validation (`update-market-data.mjs`) | yes |
| `computeLogReturns`, `sampleStandardDeviation`, `quantileInterpolated`, `rollingMeanAt` | yes |
| Channel algorithm (`computeGoldChannelBounds` ≡ `computeSP500ChannelBounds` bar the window) | yes |
| Forecast row construction (`processGenericData`) | yes |
| Stochastic traces + seeding (`generateGenericStochasticTraces`, `forecastPathSeed`) | yes |
| Heatmap (`generateGenericHeatmapData`) | yes |
| Probability forecast (`computeGenericProbabilityForecast`) | yes, label differs |
| Drift/vol estimator | **no** — §2 is gold-specific |
| Channel trend window (252 vs 126) | **no** |
| Support-aware primary trace (§7) | **no** — gold only |
