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


