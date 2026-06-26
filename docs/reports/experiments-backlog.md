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
