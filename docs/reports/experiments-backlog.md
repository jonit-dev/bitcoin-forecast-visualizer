# Bitcoin Forecaster Experiments Backlog

Purpose: canonical project log for BTC forecast research experiments, results, rerun criteria, and follow-up ideas. Use this instead of storing project-specific experiment outcomes in Hermes skills.

Hard rule: do not implement product/UI/forecast changes from an experiment unless it finds a positive, validated signal. Lucky, tiny-sample, overlapping-label, or statistically non-significant results stay as research notes only.

## Protocol

For each experiment, record:

- Date
- Status: `planned`, `running`, `completed`, `rejected`, `needs-rerun`
- Hypothesis
- Data/source changes
- Validation setup
- Report artifacts
- Result/verdict
- Rerun criteria
- Next better experiment

Skills may reference this file as the place to read/write experiment history, but should keep only reusable methodology and source patterns.

---

## 2026-06-26 — Spot ETF demand pressure

Status: `completed — rejected`

### Hypothesis

Post-2024 spot Bitcoin ETF flows provide a demand channel not captured by older Bitcoin cycle/power-law assumptions. Lag-safe daily ETF flows may improve 14/30/60/90d median forecasts in the ETF era.

### Data/source changes

Add optional public ETF flow cache:

- Source: Farside Investors public Bitcoin ETF Flow - All Data HTML table.
- Output: `src/data/etf-flow-history.json`.
- Result: 631 ETF business-day rows, `2024-01-11 → 2026-06-25`.
- Fields: daily total flow in US$m/USD, cumulative flow in US$m/USD, and per-fund daily flow columns for `IBIT`, `FBTC`, `BITB`, `ARKB`, `BTCO`, `EZBC`, `BRRR`, `HODL`, `BTCW`, `MSBT`, `GBTC`, and `BTC`.
- Availability: rows are conservatively treated as available after the next UTC day before joining into `src/data/feature-table.json`.
- Limitation: source is public HTML rather than a versioned API, so parser/source changes must fail validation and ETF fields must remain context-only unless the out-of-sample experiment passes.

Candidate features:

- Daily net ETF flow in USD.
- 5/20 ETF business-day net flows.
- 5/20-day flow as a percentage of estimated BTC market cap.
- Cumulative ETF net flow trend.
- Daily flow shock z-score using prior ETF-era history only.

### Validation setup

Script: `scripts/backtest-etf-demand.ts`

- Baseline: current `powerlaw-current` median forecast.
- Candidate form: `baseline median * exp(coefficient * feature value)` with coefficient selected on validation only.
- Validation: `2024-01-11 → 2024-12-31`.
- Final holdout: `2025-01-01 → latest available target`.
- Horizons: `14/30/60/90d`.
- Metrics: median and mean absolute log-error improvement, direction hit rate, paired block-bootstrap lower95, and robustness excluding the largest single-flow days.
- Promotion gate: enough non-overlapping samples, positive validation and holdout improvement at `14/30/60d`, positive lower95, and the effect survives excluding the largest single-flow days.

### Report artifacts

- `docs/reports/results/btc-etf-demand-2026-06-26T05-31-26-579Z.md`
- `docs/reports/results/btc-etf-demand-2026-06-26T05-31-26-579Z.json`

### Result / verdict

Verdict: `reject` for forecast influence; keep ETF flow fields context-only.

No ETF demand candidate passed the ETF-era thinned holdout promotion gate:

- `etf-flow-5d-marketcap`
  - 14d: n=37, selected coefficient `0`, improvement `0.00%`, lower95 `0.00%`.
  - 30d: n=17, selected coefficient `-0.03`, improvement `-0.78%`, lower95 `-0.78%`.
  - 60d: n=8, selected coefficient `-0.03`, improvement `-1.88%`, lower95 `-1.88%`.
  - 90d showed a `+1.00%` pocket, but only 5 thinned samples and no lower95 support.
- `etf-flow-20d-marketcap`
  - 14d: n=37, selected coefficient `0.03`, improvement `-0.09%`, lower95 `-0.56%`.
  - 30d: n=17, selected coefficient `0`, improvement `0.00%`.
  - 60d: n=8, selected coefficient `0.16`, improvement `-3.91%`, lower95 `-3.91%`.
  - 90d showed only `+0.09%` with 5 samples and failed the ex-largest-flow robustness check.
- `etf-flow-shock` worsened all tested holdout horizons.
- `etf-cumulative-trend` selected zero at 14/30/90d and worsened 60d.

Interpretation: ETF flow is useful context for the post-2024 demand regime, but the short ETF-era sample does not justify moving the median forecast.

### Rerun criteria

Rerun only if:

1. ETF source methodology changes materially or a better machine-readable source is selected.
2. More forward ETF-era holdout history accumulates enough to materially increase non-overlapping samples.
3. A new pre-registered ETF hypothesis targets interval/tail behavior rather than direct median movement.

### Next better experiment

Do not implement forecast changes. A better follow-up would test ETF flow as a context label or liquidity-stress classifier after more ETF-era history accumulates, not tune the current median on the same holdout.

---

## 2026-06-26 — Stablecoin liquidity + Binance derivatives median-ablation

Status: `completed`

### Hypothesis

Easy public liquidity/crowding data could improve BTC forecasts:

1. DeFiLlama aggregate stablecoin liquidity may improve medium-term 30–180d regime forecasts.
2. Binance funding/premium may improve short-term 7–60d leverage/crowding forecasts.

### Data/source changes

Implemented research-only public-data spike:

- `scripts/update-stablecoin-data.mjs`
  - Source: `https://stablecoins.llama.fi/stablecoincharts/all`
  - Output: `src/data/stablecoin-history.json`
  - Result: 3132 daily rows, `2017-11-29 → 2026-06-26`
- Expanded `scripts/update-derivatives-data.mjs`
  - Binance funding from `2019-09-10`
  - Binance premium index klines from `2019-12-24`
  - Binance OI remains recent-only, roughly 1 month
  - Output: `src/data/derivatives-history.json`
  - Result: 2481 rows, `2019-09-10 → 2026-06-25`
- Integrated one-day-lagged feature-table fields via `scripts/build-feature-table.ts`.
- Added research command: `npm run backtest:liquidity-derivatives`.

### Validation setup

Script: `scripts/backtest-liquidity-derivatives.ts`

- Baseline: current `powerlaw-current` median forecast.
- Candidate median form: `baseline median * exp(coefficient * featureComposite)`.
- Coefficients selected on validation period only: `2022-01-01 → 2024-12-31`.
- Final holdout: `2025-01-01 → latest available target`.
- Feature normalization: expanding-z from prior feature rows only.
- Leakage policy: feature sources are one-day lagged through `build-feature-table.ts`.
- Promotion gate: thinned/non-overlapping origins, not daily overlapping labels.

### Report artifacts

- `docs/reports/results/btc-liquidity-derivatives-ablation-2026-06-26T04-02-52-655Z.md`
- `docs/reports/results/btc-liquidity-derivatives-ablation-2026-06-26T04-02-52-655Z.json`

### Result / verdict

Stablecoin liquidity: `context-only`

- Tested:
  - `stablecoinSupplyZ365d`
  - `stablecoinSupplyChange30d`
  - `stablecoinSupplyChange90d`
  - `stablecoinLiquidityImpulse30dVsAnnual`
  - `stablecoinSupplyToBtcMarketCap`
- Best observed holdout-thinned pocket:
  - `stablecoinSupplyZ365d`, 90d horizon: about `+0.64%` mean absolute log-error improvement.
- Not stable across 30/60/180d; long-horizon holdout samples were small.
- Product use: regime/context panel only. Do not move the median forecast line from this evidence.

Binance funding/premium: `reject` for median forecast adjustment

- Tested:
  - `futuresFundingRateSumZ90d`
  - `futuresFundingRateSum30d`
  - `futuresPremiumCloseZ90d`
  - `futuresPremiumRange`
  - funding+premium crowding composite
- 7d/14d validation often selected coefficient `0`.
- 30d/60d generally worsened thinned holdout.
- Product use: maybe tail-risk/interval/liquidation context later, not median direction.

Open interest / long-short ratios: `not validated`

- Binance public OI/long-short/taker endpoints expose only roughly latest 30 days.
- OKX public Rubik endpoints can provide OI/positioning from roughly 2024 onward but were not integrated in this spike.

### Rerun criteria

Do not rerun the same median-adjustment ablation unless at least one changes materially:

1. Target changes to interval/tail-risk/NLL rather than median price.
2. Adds OKX OI/positioning or another source with materially more history.
3. Uses a new causal hypothesis, e.g. negative funding after drawdown as bounce-risk instead of generic funding z-score.
4. More forward-cached OI/long-short history has accumulated.
5. Promotion gate or baseline changes for a specific justified reason.

### Next better experiment

Derivatives should be tested as tail-risk/context, not median movement:

- extreme negative funding after drawdown → 7/14/30d bounce probability,
- high positive funding + high premium after rally → downside interval widening,
- liquidation-risk / NLL / pinball-loss calibration,
- OKX OI 2024+ as post-ETF-era context only.
---

## 2026-06-26 — Binance derivatives tail-risk / bounce-risk follow-up

Status: `completed — rejected`

### Hypothesis

The median-ablation rejected Binance funding/premium as median forecast drivers, but derivatives may still help with short-horizon risk calibration:

1. Extreme negative funding after price stress may mark short-crowding / bounce probability over 7/14/30d.
2. High positive funding plus high premium after a rally may mark crowded-long downside risk.
3. Funding/premium crowding may improve interval/NLL by widening uncertainty without moving the median.

### Validation setup

Script: `scripts/backtest-derivatives-tail-risk.ts`

- Used existing one-day-lagged feature table.
- Baseline: current `powerlaw-current` distribution.
- Candidate A: event-condition stats for negative-funding-after-drawdown and positive-crowding-after-rally.
- Candidate B: median unchanged; sigma scaled from funding/premium crowding, coefficient selected on 2022-2024 validation only.
- Final holdout: 2025+.
- Promotion gate: NLL / coverage improvement on thinned origins, plus event counts large enough to matter.

### Report artifacts

- `docs/reports/results/btc-derivatives-tail-risk-2026-06-26T04-17-23-130Z.md`
- `docs/reports/results/btc-derivatives-tail-risk-2026-06-26T04-17-23-130Z.json`

### Result / verdict

Verdict: `reject` — no positive validated signal; do not implement product/forecast changes.

Event holdout results were weak and sample-starved:

- Negative funding after drawdown:
  - 7d: n=5, excess up-rate `-6.7%`, median return `-1.6%`
  - 14d: n=3, excess up-rate `-43.2%`, median return `-4.8%`
  - 30d: n=2, excess up-rate `-41.2%`, median return `-1.9%`
- Positive crowding after rally:
  - 7d: n=6, excess up-rate `-13.3%`, median return `-2.3%`
  - 14d: n=3, excess up-rate `-9.9%`, median return `-0.4%`
  - 30d/60d: n=0

Interval holdout results did not improve:

- 7d: selected scale `0`, NLL improvement `0.0000`
- 14d: selected scale `0.1`, NLL improvement `-0.0110` (worse)
- 30d: selected scale `0`, NLL improvement `0.0000`
- 60d: selected scale `0`, NLL improvement `0.0000`

### Rerun criteria

Do not rerun this exact Binance funding/premium tail-risk experiment. Revisit only if:

1. More forward-cached derivatives history accumulates.
2. OKX/Coinglass/other OI/liquidation data is added with enough history.
3. The hypothesis changes materially and pre-registers larger event definitions before testing.

### Next better experiment

Do not move to implementation. The next research candidate should use a different data family or materially richer derivatives data, e.g. OKX OI/positioning or spot order-book/liquidity imbalance, and still must pass the hard positive-signal gate before product work.

---

## 2026-06-26 — Dynamic volatility interval model

Status: `completed — rejected`

### Hypothesis

The current power-law interval model may improve short-horizon probability calibration if volatility is forecast explicitly from recent BTC realized volatility dynamics instead of relying only on the current blended 90/365-day volatility and fitted horizon multipliers.

### Data/source changes

No new external data source. Use existing `src/data/btc-history.json` only.

Candidate sigma models:

- EWMA daily realized volatility with validation-selected decay and multiplier.
- HAR-style 7/30/90-day realized-volatility blend with validation-selected weights and multiplier.
- Volatility-of-volatility widening when recent volatility instability is elevated.
- Asymmetric widening after large downside moves.

### Validation setup

Script: `scripts/backtest-dynamic-volatility.ts`

- Baseline: current `powerlaw-current` median and current interval sigma.
- Candidate median remains unchanged.
- Parameters selected on thinned validation period only: `2022-01-01 → 2024-12-31`.
- Final holdout: `2025-01-01 → latest available target`.
- Horizons: `7/14/30/60d`.
- Metrics: NLL, 80/90/95% coverage, q05/q10/q90/q95 pinball loss, 90% interval width.
- Leakage policy: all volatility inputs use BTC rows at or before the forecast origin.
- Promotion gate: NLL improves on final holdout at `7/14/30d`, lower 95% block-bootstrap improvement is positive at promoted horizons, 90% coverage remains roughly `85-95%`, and tail pinball does not worsen on both tails.

### Report artifacts

- `docs/reports/results/btc-dynamic-volatility-2026-06-26T04-50-09-423Z.md`
- `docs/reports/results/btc-dynamic-volatility-2026-06-26T04-50-09-423Z.json`

### Result / verdict

Verdict: `reject` — no production interval/model changes.

Validation-selected candidates were all downside-widening variants, and none passed the final holdout gate:

- Best selected candidate: `downside-lb7-t0.16-s0.2`
  - 7d holdout NLL improvement `-0.0013`, lower95 `-0.0038`, coverage90 `92.0%`
  - 14d/30d NLL improvement `0.0000`, lower95 `0.0000`
- Other selected downside variants widened intervals without improving holdout NLL:
  - `downside-lb30-t0.16-s0.2`: 7d/14d/30d NLL improvements `-0.0180`, `-0.0172`, `-0.0211`
  - `downside-lb7-t0.12-s0.2`: 7d/14d NLL improvements `-0.0036`, `-0.0042`

The current interval baseline already has acceptable short-horizon 90% holdout coverage (`92.0%`, `91.9%`, `94.1%` at 7/14/30d), so simple volatility widening mostly adds width without improving likelihood.

### Rerun criteria

Rerun if:

1. The baseline interval model or fitted horizon multipliers change.
2. BTC history is materially revised.
3. A materially different volatility model family is proposed before seeing holdout results.

### Next better experiment

If dynamic volatility fails, keep current interval logic and move to point-in-time macro liquidity or on-chain interaction regimes rather than over-tuning volatility on the same holdout.

---

## 2026-06-26 — On-chain interaction regimes

Status: `completed — rejected`

### Hypothesis

Single on-chain valuation signals were weak as direct median adjustments, but interaction states may identify regimes where the current power-law median is biased. Specifically, valuation must interact with activity, miner stress, drawdown, or residual momentum to create a testable state.

### Data/source changes

No new external data source. Use existing lag-safe `src/data/feature-table.json` and its source dates.

Pre-registered interaction states:

- `cheap-and-active`: low `mvrvPercentile` or low `realizedPriceDistance`, plus rising active-address/activity trend.
- `cheap-and-dead`: low valuation plus falling active-address/activity trend.
- `miner-stress`: low miner revenue proxy plus large drawdown.
- `network-expansion`: rising activity trend with positive residual momentum.
- `valuation-activity-divergence`: valuation cheapness paired with weak/negative activity trend.

### Validation setup

Script: `scripts/backtest-onchain-interactions.ts`

- Baseline: current `powerlaw-current` median forecast.
- Candidate form: state-specific median adjustment `baseline median * exp(coefficient)` with coefficient selected on validation only.
- Validation: `2022-01-01 → 2024-12-31`.
- Final holdout: `2025-01-01 → latest available target`.
- Horizons: `30/60/90/180d`.
- Metrics: thinned mean absolute log-error improvement, median absolute log error, direction hit rate, event counts, and paired bootstrap lower 95% bound.
- Leakage policy: use feature-table rows keyed by forecast origin; all feature sources must remain one-day lagged per `npm run validate:features`.
- Promotion gate: a state must have at least 5 thinned holdout samples at a claimed horizon, positive validation improvement, positive holdout improvement with positive lower95 bound, no material degradation on adjacent horizons, and an interpretable reason code.

### Report artifacts

- `docs/reports/results/btc-onchain-interactions-2026-06-26T04-53-26-666Z.md`
- `docs/reports/results/btc-onchain-interactions-2026-06-26T04-53-26-666Z.json`

### Result / verdict

Verdict: `reject` — no production forecast/product changes.

The final holdout is too sample-starved for these pre-registered states:

- `cheap-and-active`: 1 thinned holdout sample at 30d, 1 at 60d, 0 at 90/180d.
- `cheap-and-dead`: 0 thinned holdout samples across 30/60/90/180d.
- `miner-stress`: 0 thinned holdout samples across 30/60/90/180d.
- `network-expansion`: 1 thinned holdout sample at 30d, 0 at 60/90/180d.
- `valuation-activity-divergence`: 0 thinned holdout samples across 30/60/90/180d.

The only positive-looking pocket was `cheap-and-active` at 60d (`+8.02%` mean absolute log-error improvement), but it had only one holdout sample and no lower95 estimate. This stays as a research note only.

### Rerun criteria

Rerun only if:

1. New lag-safe on-chain fields are added.
2. A materially different interaction definition is pre-registered before checking holdout.
3. The baseline power-law median changes.

### Next better experiment

If these interactions fail, do not keep mining MVRV/activity combinations on the same holdout. Move to macro liquidity, ETF demand pressure, or market-data quality instead.

---

## 2026-06-26 — Market data quality and volume audit

Status: `completed`

### Hypothesis

Before using exchange volume or replacing the canonical BTC candle cache, the app needs an auditable comparison between the current CoinGecko-derived daily candles and public exchange-specific UTC daily candles. Source methodology differences may explain close/volume drift, and any later volume feature should only start from a stable source.

### Data/source changes

No production source change planned for the audit.

Candidate public sources:

- Current canonical cache: `src/data/btc-history.json`, built from CoinGecko hourly market chart prices plus daily volume snapshots.
- Binance spot `BTCUSDT` 1d klines.
- Coinbase Exchange `BTC-USD` 1d candles.
- Kraken `XBT/USD` 1d OHLC.

### Validation setup

Script: `scripts/audit-market-data-quality.ts`

- Compare overlapping UTC dates in the recent one-year window.
- Metrics: close absolute percentage difference, OHLC consistency violations, missing days, and volume correlation versus canonical volume.
- Report per-source overlap, latest date, median/p95/max close difference, large-difference day counts, and volume correlation.
- This is a data-quality audit, not a forecast-alpha claim.

### Report artifacts

- `docs/reports/results/btc-market-data-quality-2026-06-26T04-57-51-659Z.md`
- `docs/reports/results/btc-market-data-quality-2026-06-26T04-57-51-659Z.json`

### Result / verdict

Verdict: `needs-review` — no production source replacement and no volume forecast feature.

All three public exchange sources were available over the `2025-06-19 → 2026-06-18` audit window with full canonical-date overlap and no OHLC consistency violations.

Close-price agreement versus the canonical CoinGecko-derived cache was tight enough for drift monitoring:

- Binance BTCUSDT: median close difference `0.18%`, p95 `0.81%`, max `1.95%`.
- Coinbase BTC-USD: median close difference `0.16%`, p95 `0.79%`, max `1.96%`.
- Kraken XBT/USD: median close difference `0.16%`, p95 `0.80%`, max `1.97%`.

Volume is not model-ready as a direct replacement for canonical aggregate USD volume:

- Binance quote-volume correlation versus canonical volume: `0.5101`, median ratio `0.0348`.
- Coinbase base BTC volume converted to USD: correlation `0.4478`, median ratio `0.0148`.
- Kraken base BTC volume converted to USD: correlation `0.4141`, median ratio `0.0034`.

Interpretation: exchange candles can support a source-methodology drift report, but exchange-specific volume is venue-level flow, not aggregate market volume. Any volume feature needs a separate pre-registered ablation and probably multiple-exchange aggregation.

### Rerun criteria

Rerun if:

1. The canonical BTC updater changes source or candle construction.
2. A candidate exchange API schema changes.
3. A later volume-feature ablation is proposed.

### Next better experiment

If source deltas are small and reproducible, volume-feature research may be pre-registered separately. If deltas are large or source coverage is unstable, keep volume out of forecast modeling and document the limitation.

---

## 2026-06-26 — Sentiment extremes event study

Status: `completed — rejected`

### Hypothesis

Alternative.me Fear & Greed extremes may classify capitulation or euphoria events, but are likely redundant with price, volatility, and drawdown. Sentiment should start as optional context and only influence forecasts if extreme-event behavior improves out-of-sample versus both unconditional and price-context baselines.

### Data/source changes

Add optional public sentiment cache:

- Source: `https://api.alternative.me/fng/?limit=0&format=json`
- Output: `src/data/sentiment-history.json`
- Result: 3064 daily rows, `2018-02-01 → 2026-06-26`
- Fields: Fear & Greed index value, source classification, 7d/30d changes, extreme fear/greed flags.
- Availability: each source date is treated as available after the next UTC day before joining into `src/data/feature-table.json`.

### Validation setup

Script: `scripts/backtest-sentiment-extremes.ts`

- Baseline: current `powerlaw-current` median forecast.
- Candidate form: event-specific median adjustment `baseline median * exp(coefficient)` with coefficient selected on validation only.
- Event states:
  - `extreme-fear`
  - `extreme-greed`
  - `fear-after-drawdown`
  - `greed-after-rally`
  - `sentiment-price-divergence`
- Validation: `2022-01-01 → 2024-12-31`.
- Final holdout: `2025-01-01 → latest available target`.
- Horizons: `7/14/30/60d`.
- Metrics: event counts, mean absolute log-error improvement, lower95 paired block bootstrap, direction hit rate, median forward return, and comparison to price-context event baselines.
- Promotion gate: at least 10 thinned holdout samples for a claimed state/horizon, positive validation improvement, positive holdout improvement with positive lower95 bound, and improvement over the matching price-only event baseline.

### Report artifacts

- `docs/reports/results/btc-sentiment-extremes-2026-06-26T05-08-19-361Z.md`
- `docs/reports/results/btc-sentiment-extremes-2026-06-26T05-08-19-361Z.json`

### Result / verdict

Verdict: `reject` for forecast influence; keep sentiment as optional context/freshness only.

No sentiment event passed the thinned holdout promotion gate:

- `extreme-fear`
  - 7d: n=25, selected coefficient `0`, improvement `0.00%`, lower95 `0.00%`
  - 14d: n=12, selected coefficient `0.03`, improvement `-1.16%`, lower95 `-1.16%`
- `fear-after-drawdown`
  - 7d: n=22, selected coefficient `0`, improvement `0.00%`, lower95 `0.00%`
  - 14d: n=11, selected coefficient `0.03`, improvement `-1.32%`, lower95 `-1.32%`
- `extreme-greed` and `greed-after-rally` were sample-starved in 2025+ holdout: 3 samples at 7d, 2 at 14d, 0 at 30/60d.
- `sentiment-price-divergence` was sample-starved: 5 samples at 7d, 2 at 14d, 1 at 30/60d.

Sentiment is now available as lag-safe optional context fields in the feature table, but forecast median/interval logic remains unchanged.

### Rerun criteria

Rerun if:

1. Alternative.me source history materially changes or becomes unavailable.
2. A new non-price sentiment source is added.
3. The event definitions are materially changed before checking holdout.

### Next better experiment

If sentiment fails, keep it as optional context/freshness only and do not add Google Trends until a reproducible source workflow is selected.

---

## 2026-06-26 — CME COT positioning event study

Status: `completed`

### Hypothesis

CME Bitcoin futures positioning may provide a cleaner institutional leverage signal than Binance funding/premium. Weekly CFTC TFF positioning may help classify 7/14/30/60d tail risk or interval calibration, but it should not be tested first as a generic daily median adjustment.

### Data/source changes

Add optional public COT cache:

- Source: CFTC Public Reporting Socrata dataset `gpe5-46if`, TFF Futures Only.
- Contracts:
  - Bitcoin CME futures code `133741`, contract size 5 BTC.
  - Micro Bitcoin CME futures code `133742`, contract size 0.1 BTC.
- Output: `src/data/cot-history.json`.
- Result: 428 weekly rows, `2018-04-10 → 2026-06-16`.
- Fields: aggregate BTC-equivalent open interest, leveraged-money net position, asset-manager net position, dealer net position, each as BTC-equivalent and percent of open interest.
- Availability: CFTC report dates are Tuesday; rows are conservatively treated as available after Saturday `00:00 UTC` to avoid assigning Friday report information to earlier forecast origins.

### Validation setup

Script: `scripts/backtest-cme-cot.ts`

- Baseline: current `powerlaw-current` median and sigma.
- Candidate A: weekly-origin event stats for crowded-short, crowded-long, asset-manager-long, dealer-short, and open-interest-expansion states.
- Candidate B: median unchanged; sigma widened for event states with scale selected on validation only.
- Validation: `2022-01-01 → 2024-12-31`.
- Final holdout: `2025-01-01 → latest available target`.
- Horizons: `7/14/30/60d`.
- Metrics: event counts, up-rate, median return, large-down/large-up rates, NLL improvement, 90% coverage, q05/q95 pinball loss, and non-overlapping weekly origins.
- Promotion gate: event counts meet at least 10 thinned holdout samples at claimed horizon, tail classification improves versus the matching unconditional baseline, NLL or tail pinball improves with positive lower95 bound, and results survive weekly-origin spacing.

### Report artifacts

- `docs/reports/results/btc-cme-cot-2026-06-26T05-16-53-701Z.md`
- `docs/reports/results/btc-cme-cot-2026-06-26T05-16-53-701Z.json`

### Result / verdict

Verdict: `context-only` — no production forecast change.

The only eligible holdout event with enough samples was `leveraged-money-crowded-short`:

- 7d: n=19, up-rate `42.1%`, excess up-rate `-5.3%`, median return `-1.0%`, selected interval scale `0`, NLL improvement `0.0000`.
- 14d: n=19, up-rate `36.8%`, excess up-rate `-11.2%`, median return `-2.0%`, selected interval scale `0.1`, NLL improvement `-0.0463` with lower95 `-0.0741`.
- 30d: n=19, up-rate `52.6%`, excess up-rate `+3.3%`, median return `+0.3%`, selected interval scale `0`, NLL improvement `0.0000`.
- 60d: n=19, up-rate `42.1%`, excess up-rate `-4.3%`, median return `-8.1%`, selected interval scale `0`, NLL improvement `0.0000`.

Other pre-registered events were not usable in the 2025+ holdout:

- `leveraged-money-crowded-long`: 0 samples across 7/14/30/60d.
- `asset-manager-crowded-long`: 0 samples across 7/14/30/60d.
- `dealer-short-pressure`: 0 samples across 7/14/30/60d.
- `open-interest-expansion`: 2 samples across 7/14/30/60d.

Interpretation: crowded leveraged-money short positioning may be a useful context label, but the interval/tail metric gate failed and the effect is not stable enough to alter forecasts.

### Rerun criteria

Rerun if:

1. CFTC dataset fields or contract listings change.
2. A materially different event definition is pre-registered before holdout review.
3. More forward history accumulates enough to change event counts materially.

### Next better experiment

If COT fails, keep it as context-only institutional positioning. Do not combine it with Binance derivatives unless a separate pre-registered richer positioning experiment is defined.

---

## 2026-06-26 — Point-in-time macro liquidity regime

Status: `completed — rejected`

### Hypothesis

Bitcoin forecast errors and interval miscalibration are regime-dependent on liquidity and macro stress. A lag-safe macro regime score may improve 30/60/90/180d NLL, pinball loss, or regime-conditioned error without directly overfitting price residuals.

### Data/source changes

Use official FRED CSV endpoints, no API key required:

- `WALCL`: Fed balance sheet.
- `FEDFUNDS`: effective federal funds rate.
- `DGS10`: 10-year Treasury yield.
- `BAMLH0A0HYM2`: high-yield spread.
- `M2SL`: M2 money supply.

Output: `src/data/macro-history.json`.
Result: 1095 daily aligned rows, `2023-06-26 → 2026-06-24`.

Limitations:

- This is latest-observation FRED data, not ALFRED vintages.
- Rows use a conservative 30-day `availableAfter` lag for feature-table joins to reduce publication/revision lookahead risk.
- Macro fields remain context-only unless out-of-sample evidence is strong and the revision limitation is accepted.

### Validation setup

Script: `scripts/backtest-macro-liquidity.ts`

- Baseline: current `powerlaw-current` median and sigma.
- Candidate A: macro regime event stats for stress, liquidity easing, tightening, and credit stress.
- Candidate B: median unchanged; sigma widened or narrowed from transparent macro regimes with scale selected on validation only.
- Validation: `2022-01-01 → 2024-12-31`.
- Final holdout: `2025-01-01 → latest available target`.
- Horizons: `30/60/90/180d`.
- Metrics: NLL improvement, q05/q95 pinball, 90% coverage, median absolute log error guardrail, event counts, and paired block-bootstrap lower95.
- Promotion gate: NLL or tail pinball improves on final holdout at 30/60/90d with positive lower95, 90% coverage remains sane, median absolute log error does not materially degrade, and `npm run validate:features` passes.

### Report artifacts

- `docs/reports/results/btc-macro-liquidity-2026-06-26T05-23-29-014Z.md`
- `docs/reports/results/btc-macro-liquidity-2026-06-26T05-23-29-014Z.json`

### Result / verdict

Verdict: `reject` for forecast influence; keep macro fields context-only.

The latest-observation FRED implementation was too sample-starved after conservative lagging and the available high-yield spread history:

- `macro-stress`: 3 holdout samples at 30d, 1 at 60/90/180d; selected scale `0` except no improvement.
- `credit-stress`: 3 holdout samples at 30d, 1 at 60/90/180d; selected scale `0`.
- `liquidity-easing`: 2 holdout samples at 30d, 1 at 60d, 0 at 90/180d; selected scale `0`.
- `tightening-pressure`: 1 holdout sample at each horizon; 60d selected scale `0.5` but worsened NLL by `-0.3057`.

No regime met the minimum sample count or positive lower95 requirement. Latest FRED observations are also not vintage-safe, so macro remains context-only until ALFRED/vintage-safe data or a longer usable source history is available.

### Rerun criteria

Rerun if:

1. ALFRED vintage-safe data is added.
2. Macro publication lag handling changes materially.
3. The baseline interval model changes.

### Next better experiment

If latest-observation FRED macro fails, do not tune macro score weights on the same holdout. Use ALFRED vintages or a different macro hypothesis before revisiting.

---

## 2026-07-06 — Continuous residual feature-family redesign

Status: `completed`

### Hypothesis

The failed sparse/event feature studies may be too brittle. Continuous, lag-safe residual features across on-chain, derivatives, ETF, macro, sentiment, stablecoins, and COT families may improve residual-distribution calibration without directly overfitting the median forecast.

### Data/source changes

No production forecast inputs were enabled. The experiment added a lag-safe residual-feature dataset builder for feature families and horizons `7/14/30/60/90/180d`, with explicit source-date checks and holdout windows.

### Validation setup

Script: `scripts/backtest-feature-family.ts`

- Command: `npm run backtest:features-continuous`
- Baseline: current residual-decay distribution.
- Candidate: pre-holdout ridge residual model per family/horizon/holdout.
- Holdouts: `2022-01-01` where history supports it, otherwise `2025-01-01`.
- Metrics: q10/q50/q90 pinball loss, NLL, 80% residual coverage, sample counts, and block-bootstrap pinball-loss improvement intervals.
- Promotion gate: positive mean pinball improvement with positive lower95 and no material coverage degradation.

### Report artifacts

- `docs/reports/results/feature-continuous-all-2026-07-07T00-13-44-633Z.md`
- `docs/reports/results/feature-continuous-all-2026-07-07T00-13-44-633Z.json`

### Result / verdict

Verdict: mixed, report-only. Do not move the production forecast from these signals.

- `onchain`, `etf`, and `macro`: `context-only`; continuous residual gates did not beat the current residual-decay baseline.
- `derivatives`: `context-only`; sample-starved in the usable holdout.
- `sentiment` and `stablecoins`: `watch`; mean pinball improved in pockets, but bootstrap lower95 did not clear promotion.
- `cot`: `eligible-for-manual-review`; some gates cleared pinball/coverage criteria, but this remains report-only until reviewed and promoted explicitly.

### Rerun criteria

Rerun if:

1. New forward holdout history materially changes sample counts.
2. A family source or feature construction changes materially.
3. The residual baseline changes.
4. COT manual review produces a pre-registered promotion candidate.

### Next better experiment

Keep all families out of forecast alpha until a family-specific candidate is reviewed against fresh holdout data and the default `npm run backtest` gate passes with the signal enabled.

---

## 2026-07-06 — Kitchen-sink residual model

Status: `completed — rejected`

### Hypothesis

A walk-forward model using all available lag-safe feature families may improve residual quantile calibration more than single-family gates.

### Data/source changes

No new data source. The model consumes the existing lag-safe feature table and records selected feature names and training windows for each origin.

### Validation setup

Script: `scripts/backtest-residual-model.ts`

- Command: `npm run backtest:residual-model`
- Candidate: walk-forward kitchen-sink residual model.
- Baseline: current residual-decay distribution.
- Metrics: q10/q50/q90 pinball loss and 80% residual coverage.
- Leakage guard: every evaluation records training end date before evaluation origin.

### Report artifacts

- `docs/reports/results/residual-model-2026-07-07T00-14-32-622Z.md`
- `docs/reports/results/residual-model-2026-07-07T00-14-32-622Z.json`

### Result / verdict

Verdict: `disabled-negative-result`.

The kitchen-sink model did not beat pure residual decay broadly enough to enable new alpha. Keep it as a negative research result and do not wire it into production forecasts.

### Rerun criteria

Rerun only if:

1. The feature table changes materially.
2. A simpler pre-registered residual model is proposed.
3. Fresh forward data gives a materially larger evaluation window.

### Next better experiment

Prefer family-specific, interpretable residual hypotheses over a broad kitchen-sink model.

---

## 2026-07-06 — Buy-zone scoring diagnostics

Status: `completed`

### Hypothesis

Composite bottom-zone features may identify historically favorable entry zones, but BTC bottom samples are small and overlapping.

### Data/source changes

Added a report-only buy-zone summary based on residual percentile, MVRV percentile, realized-price distance, and drawdown pain.

### Validation setup

Script: `scripts/backtest-buy-zones.ts`

- Command: `npm run backtest:buy-zones`
- Metrics: 1y/2y forward returns, 1y max gain, 180d worst drawdown, event counts, and pooled sample diagnostics.
- Promotion gate: sample threshold must be met before any product wording can imply forecast alpha.

### Report artifacts

- `docs/reports/results/buy-zone-backtest-2026-07-07T00-14-33-435Z.md`
- `src/data/buy-zone-summary.json`

### Result / verdict

Verdict: `candidate/watch`, not forecast alpha.

Latest run: 4,929 scored points, 12 zones, latest score `0.647`, not heavy-buy. Event samples remain below the documented promotion threshold, so this remains context only.

### Rerun criteria

Rerun when the feature table updates or if thresholds are changed before looking at new holdout results.

### Next better experiment

Use buy-zone state as a watch/context overlay only. Do not let it move median forecasts or interval widths without a separate promotion gate.

---

## 2026-07-06 — Validation-weighted ensemble and tail-risk promotion gates

Status: `completed`

### Hypothesis

Validation-weighted blends of power-law, GBM-recent-drift, and MA-trend models, or conditional tail-risk interval multipliers, may improve forecast calibration after core-model and feature evidence is available.

### Data/source changes

No new source. Added explicit disabled configuration and report-only suites for ensemble and tail-risk candidates.

### Validation setup

Scripts:

- `npm run backtest:ensemble-suite`
- `npm run backtest:tail-risk-suite`

Baseline: current `powerlaw-current` forecast distribution. Production enablement requires the corresponding suite gate to pass when the config is explicitly enabled.

### Report artifacts

- `docs/reports/results/backtest-2026-07-07T00-13-11-162Z.json`
- `docs/reports/results/backtest-2026-07-07T00-13-11-162Z.md`
- `docs/reports/results/backtest-2026-07-07T00-13-13-889Z.json`
- `docs/reports/results/backtest-2026-07-07T00-13-13-889Z.md`

### Result / verdict

Verdict: report-only.

- Ensemble: `disabled`; it did not beat the best single member reliably enough to promote.
- Tail risk: `eligible-for-manual-review`, but `enabled=false`; conditional multipliers need explicit review before they can affect intervals.

### Rerun criteria

Rerun if:

1. The baseline model changes.
2. Ensemble member definitions or weights change.
3. Tail-risk flag definitions or multiplier grids change.
4. Manual review proposes enabling either feature.

### Next better experiment

Do not enable ensemble or tail-risk behavior unless the relevant config is changed intentionally and the enabled-mode `npm run backtest` gate passes.


## 2026-07-10 — Daily production market-quote refresh architecture

Status: `implementation validated locally — preview/production observation pending`

### Hypothesis

A daily Cloudflare scheduled Worker can refresh validated BTC, VOO, and GLD candles into shared D1 storage, keeping production quotes current without daily rebuilds while preserving the bundled-data fallback and existing forecast calibration.

### Data/source changes

Planned operationalization of the existing sources and instruments only:

- BTC/USD daily UTC candles from the current CoinGecko market-chart methodology.
- VOO adjusted daily OHLCV as the S&P 500 proxy from the current Yahoo chart methodology.
- GLD adjusted daily OHLCV as the gold proxy from the current Yahoo chart methodology.
- New mutable D1 storage for validated recent candles and refresh-run metadata; no source promotion and no forecast feature/model change.

### Validation setup

- PRD: `docs/PRDs/DAILY_PRODUCTION_MARKET_QUOTES.md`.
- Verify source adapters against captured fixtures and the current CLI updater conventions.
- Prove completed-candle filtering, schema/OHLC validation, recent-window repair, per-asset isolation, and idempotent D1 upserts.
- Verify weekend/holiday no-op behavior for VOO/GLD and completed-UTC-day behavior for BTC.
- Verify browser hydration and `/api/forecast` use the same latest candle, with bundled JSON fallback during D1/source failure.
- Run `npm run backtest`, `npm run backtest:market`, `npm test`, and `npm run lint` after implementation.
- This entry validates data delivery and operational parity only. It cannot authorize new sources, model inputs, coefficients, or UI/forecast behavior beyond freshness/status plumbing.

### Report artifacts

- Planned PRD: `docs/PRDs/DAILY_PRODUCTION_MARKET_QUOTES.md`.
- Local implementation evidence: 17 Vitest files / 45 tests passed; TypeScript and production build passed; local D1 migration applied successfully.
- BTC regression: `docs/reports/results/backtest-2026-07-10T19-27-53-869Z.md` and `.json` (`npm run backtest`: quality and robustness PASS).
- VOO/GLD regression: `npm run backtest:market` PASS at every configured horizon (console evidence in implementation handoff).
- Preview/production scheduled-run logs, D1 inspection, and endpoint smoke output remain deployment-environment evidence.

### Result / verdict

Local verdict: positive operational implementation signal. Source adapters, D1 idempotency, fallback API behavior, browser merge behavior, TypeScript, tests, build, and forecast regression gates pass. Forecast formulas and source identities are unchanged. Production enablement remains gated on replacing D1 ID placeholders and completing preview scheduled-run/API agreement proof; seven-day reliability observation remains follow-up evidence.

### Rerun criteria

Rerun operational validation when an upstream response schema/methodology changes, a supported asset or source is added, the cron schedule/storage changes, or freshness/forecast endpoints disagree in production.

### Next better experiment

Implement the PRD in gated vertical slices, observe at least seven consecutive scheduled runs including one equity-market weekend, then evaluate source reliability and freshness misses before considering any source replacement or wider data-pipeline scheduling.

---
