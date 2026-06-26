# Public Data Forecast Experiment Proposals

Date: 2026-06-26

Purpose: propose non-duplicative public-data experiments that could materially improve Bitcoin forecasting ability, while preserving the project rule that no forecast/product change ships unless it proves out-of-sample value.

## Complexity

Complexity: 8 -> HIGH mode if implemented as one PRD.

Score:
- +2 new research modules/scripts
- +2 complex state/model validation logic
- +1 external public API integrations
- +2 multi-source feature table changes
- +1 report/backtest integration

This document is a planning artifact only. It does not implement experiments.

## Existing Work To Avoid Repeating

Source of truth: `docs/reports/experiments-backlog.md`.

Do not rerun these exact experiments unless their own rerun criteria are satisfied:

- Stablecoin liquidity median-ablation using DeFiLlama stablecoin supply features.
- Binance funding/premium median-ablation.
- Binance funding/premium tail-risk and bounce-risk follow-up.
- Generic funding z-score, premium z-score, and funding-plus-premium crowding composites.

Also avoid repeating these already-documented project experiments:

- Simple residual mean-reversion tau retuning.
- Small one-day-lagged residual momentum, value, MVRV, or bear-penalty median adjustments.
- Validation-selected scalar interval rescaling.
- Heavy buy-zone scoring from residual cheapness, MVRV cheapness, realized-price distance, and drawdown pain.
- BTC/S&P rolling correlation and beta as point-forecast alpha.
- Power-law coefficient refit as a direct replacement without separate candidate validation.

## Global Experiment Protocol

Every experiment below should be pre-registered before implementation:

- Add a `planned` entry to `docs/reports/experiments-backlog.md`.
- State the exact hypothesis, data fields, validation split, final holdout, metrics, and promotion gate.
- Use only source data available before the forecast origin.
- Store source dates per feature in `src/data/feature-table.json`.
- Prefer thinned or non-overlapping origins for event studies.
- Compare against `powerlaw-current`, naive/current-price, GBM, and trend baselines where relevant.
- Write timestamped JSON and Markdown artifacts under `docs/reports/results/`.
- Keep new signals context-only unless the promotion gate passes.

Default split unless a proposal says otherwise:

- Validation: `2022-01-01` through `2024-12-31`.
- Final holdout: `2025-01-01` through latest available target.
- Horizons: `7, 14, 30, 60, 90, 180, 365`.
- Required promotion horizons: `14, 30, 60, 90`.
- Primary metrics: median absolute log error for median experiments; NLL and pinball loss for distribution experiments.
- Robustness: paired block bootstrap with positive lower 95% bound on required horizons.

## Priority List

| Priority | Experiment | Main Target | Public Data | Expected Upside |
| --- | --- | --- | --- | --- |
| P0 | Point-in-time macro liquidity regime | 30-180d distribution and regime errors | FRED/ALFRED | Captures liquidity/risk-on conditions missing from price-only model |
| P0 | Dynamic volatility model | 7-60d intervals | Existing BTC OHLCV | Improves calibrated probability bands without claiming directional alpha |
| P1 | Spot ETF demand pressure | 14-90d post-2024 behavior | Public ETF flow/holdings pages | Captures ETF-era demand channel absent from old cycle models |
| P1 | CME COT positioning | 7-60d tail/NLL | CFTC COT | Cleaner regulated positioning proxy than Binance funding |
| P1 | On-chain interaction regimes | Regime-conditioned calibration | Existing CoinMetrics/on-chain cache | Tests interactions, not simple MVRV/residual tweaks |
| P2 | Market data quality and volume audit | Data robustness, later volume features | Coinbase/Kraken/Binance public OHLCV | Detects vendor methodology issues before modeling volume |
| P3 | Sentiment extremes | Context/event classification | Alternative.me Fear & Greed | Low-cost context, forecast-disabled unless proven |

## Experiment 1: Point-In-Time Macro Liquidity Regime

### Hypothesis

Bitcoin forecast errors and interval miscalibration are regime-dependent on liquidity and macro stress. A lag-safe macro regime score can improve 30-180 day NLL, pinball loss, or regime-conditioned median error without directly overfitting price residuals.

### Data

Candidate public sources:

- FRED/ALFRED `WALCL`: Fed balance sheet.
- FRED/ALFRED `DFF` or `FEDFUNDS`: policy rate.
- FRED `DGS10`: 10-year Treasury yield.
- FRED high-yield spread series such as `BAMLH0A0HYM2`.
- FRED `M2SL`: M2 money supply.
- Optional: reverse repo and Treasury General Account if source handling is clean.

Use ALFRED vintages where feasible. If only FRED latest-observation data is used, mark revision-sensitive fields as context-only until a vintage-safe implementation exists.

### Candidate Features

- Liquidity impulse: 13-week and 26-week change in Fed balance sheet.
- Rate pressure: current policy rate, 13-week rate change, real-rate proxy if inflation data is added safely.
- Credit stress: high-yield spread level and z-score.
- Yield trend: 10-year yield change over 30/90 days.
- Macro risk score: a transparent weighted score from prior-window z-scores.

### Validation

- First target: interval/NLL improvement, not median-line movement.
- Use source publication dates or conservative lag assumptions.
- Evaluate 30/60/90/180d horizons.
- Report regime-conditioned errors: easing/liquidity-up, tightening/liquidity-down, stress, neutral.

### Promotion Gate

Promote only if:

- NLL or pinball loss improves on final holdout at 30/60/90d.
- Lower 95% block-bootstrap improvement is positive for the required horizons being claimed.
- Median absolute log error does not degrade materially.
- Feature source dates pass `npm run validate:features`.

## Experiment 2: Dynamic Volatility Model

### Hypothesis

The current interval model can be improved by forecasting volatility explicitly instead of using a fixed blended 90/365-day volatility and stress multiplier. This is distinct from the rejected scalar interval-rescaling experiment.

### Data

- Existing `src/data/btc-history.json`.
- No new external source required for the first pass.

### Candidate Models

- EWMA daily volatility with decay selected on validation only.
- HAR-style realized volatility using 7/30/90-day realized vol components.
- Volatility-of-volatility widening rule for abrupt regime transitions.
- Asymmetric interval widening after large downside moves.

### Validation

- Baseline: current `computePowerLawInterval`.
- Candidate median remains unchanged.
- Compare NLL, pinball q05/q10/q90/q95, and 80/90/95% coverage.
- Required horizons: 7/14/30/60d.

### Promotion Gate

Promote only if:

- Final-holdout NLL improves at 7/14/30d.
- 90% coverage remains within roughly 85-95% at promoted horizons.
- Pinball loss does not worsen on both tails.
- The model does not create wide trivial bands that only improve coverage.

## Experiment 3: Spot ETF Demand Pressure

### Hypothesis

Post-2024 spot ETF flows and holdings provide a demand channel not captured by older Bitcoin cycle/power-law assumptions. ETF pressure may improve 14-90 day forecasts or regime labels in the ETF era.

### Data

Candidate public sources:

- Public BTC ETF daily flow tables.
- Issuer holdings pages for IBIT, FBTC, BITB, ARKB, and other major spot BTC ETFs.
- Public AUM/holdings snapshots where source methodology is stable.

Prefer machine-readable or scrape-stable sources. If source terms or format are unstable, keep this as a manual research note and do not wire into refresh automation.

### Candidate Features

- Daily net ETF flow in USD.
- 5/20-day net flow.
- Flow as percentage of BTC spot volume.
- Flow as percentage of estimated BTC market cap.
- Cumulative ETF net flow trend.
- Flow shock z-score using only prior ETF-era history.

### Validation

- ETF-era only.
- Validation: 2024 launch through `2024-12-31`.
- Final holdout: `2025-01-01` onward.
- Use thinned origins because ETF history is short.
- Compare against baseline plus macro and residual context if macro has already been validated.

### Promotion Gate

Promote only if:

- Enough non-overlapping samples exist for the claimed horizon.
- 14/30/60d median error or NLL improves on final holdout.
- Effect survives excluding the largest single-flow days.
- Source methodology and lag are documented in `docs/reports/data-sources.md`.

## Experiment 4: CME COT Positioning

### Hypothesis

CME Bitcoin futures positioning may provide a cleaner, longer-lived leverage and institutional positioning signal than Binance funding/premium. This is materially different from the rejected Binance experiments.

### Data

Candidate public source:

- CFTC Commitments of Traders historical reports.
- Bitcoin CME futures code `133741`.
- Micro Bitcoin futures code `133742`, if history and aggregation are clean.

Respect weekly report timing. Do not assign Friday report information to earlier forecast origins unless release timing is modeled conservatively.

### Candidate Features

- Leveraged-money net position.
- Asset-manager net position.
- Dealer net position.
- Open interest level and change.
- Positioning percentile versus prior history.
- Crowded-long or crowded-short event flags.

### Validation

- Weekly-origin event study first.
- Target: 7/14/30/60d tail-risk, NLL, and large-move classification.
- Do not test as a generic daily median adjustment on the first pass.
- Event definitions must be pre-registered before looking at holdout results.

### Promotion Gate

Promote only if:

- Event counts meet a pre-set minimum.
- Tail classification improves versus unconditional baseline.
- NLL or interval tail pinball improves on final holdout.
- Results survive non-overlapping weekly origins.

## Experiment 5: On-Chain Interaction Regimes

### Hypothesis

Single on-chain valuation signals are weak as direct median adjustments, but interactions may identify regimes where the baseline forecast is biased or miscalibrated. For example, cheap valuation plus rising activity may have different forward behavior than cheap valuation plus falling activity.

### Data

Use existing public CoinMetrics-derived caches:

- MVRV.
- Realized-price distance.
- Active addresses.
- Transaction count.
- Transfer count.
- Funded address count.
- Hash rate.
- Miner revenue proxy.
- Volatility and drawdown from existing BTC history.

### Candidate Features

- Cheap-and-active: low MVRV or realized-price distance plus rising active-address trend.
- Cheap-and-dead: low valuation plus falling activity/fees.
- Miner-stress regime: low miner revenue proxy plus large drawdown.
- Network-expansion regime: rising address/activity trend with positive residual momentum.
- Valuation/activity divergence score.

### Validation

- Target regime-conditioned errors and distribution calibration first.
- The experiment must not reuse the simple MVRV value adjustment from June 12.
- Compare within each top-state bucket and against unconditional baseline.

### Promotion Gate

Promote only if:

- A pre-registered interaction state has enough samples.
- Baseline error is statistically different in that state.
- A transparent state-specific median or interval adjustment improves final-holdout metrics.
- The interaction remains interpretable enough for UI reason codes.

## Experiment 6: Market Data Quality And Volume Audit

### Hypothesis

Some forecast error and feature instability may come from source methodology, candle construction, or volume quality. Before using volume as a forecast signal, the app should compare public exchange-specific candles against the current BTC cache.

### Data

Candidate public sources:

- Coinbase BTC-USD daily candles.
- Kraken XBT/USD daily candles.
- Binance BTCUSDT daily candles where operationally appropriate.

### Candidate Checks

- UTC close mismatch versus current cache.
- High/low/open consistency.
- Volume correlation and outlier detection.
- Missing-day behavior and source outages.
- Source-methodology drift report.

### Validation

- First pass is a data-quality report, not a forecast-alpha claim.
- Forecast experiment only begins if the audit finds stable volume data.
- Later candidate features could include spot volume z-score, volume trend, and volume/volatility interaction.

### Promotion Gate

Promote only if:

- Exchange candles can be regenerated reproducibly.
- Source deltas are documented and stable.
- Any volume feature beats baseline in a separately pre-registered ablation.

## Experiment 7: Sentiment Extremes

### Hypothesis

Fear/greed extremes may help classify capitulation or euphoria events, but sentiment is likely redundant with price, volatility, and drawdown. It should start as optional context.

### Data

Candidate public source:

- Alternative.me Fear & Greed Index API.

Google Trends remains deferred unless a reproducible machine-readable workflow is selected.

### Candidate Features

- Fear/Greed index level.
- 7/30-day change.
- Extreme fear event.
- Extreme greed event.
- Sentiment divergence versus price residual.

### Validation

- Event study only.
- Thinned origins.
- Compare event-conditioned forward return, drawdown, NLL, and tail pinball.
- Do not move the median forecast by default.

### Promotion Gate

Promote only if:

- Extreme-event samples are sufficient.
- Final-holdout event behavior beats unconditional and price-only event baselines.
- Sentiment remains optional in freshness checks.

## Suggested Implementation Order

1. Dynamic volatility model.
2. Point-in-time macro liquidity regime.
3. On-chain interaction regimes.
4. Spot ETF demand pressure.
5. CME COT positioning.
6. Market data quality and volume audit.
7. Sentiment extremes.

Reasoning:

- Dynamic volatility has the best chance of improving probability calibration without needing new data.
- Macro liquidity and on-chain interactions address known model blind spots with public data and enough history.
- ETF flow is important but short-history, so it should be tested carefully.
- CME COT is materially different from Binance funding but lower cadence.
- Market data quality is foundational, but likely less immediately predictive.
- Sentiment is cheap to add but lower expected value.

## Acceptance Criteria For This Proposal

- The proposal does not duplicate completed/rejected backlog experiments.
- Every experiment has a clear public-data source family.
- Every experiment has a falsifiable hypothesis.
- Every experiment has a validation target and promotion gate.
- No experiment recommends product/UI/default forecast changes before out-of-sample evidence exists.

