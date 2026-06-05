# ROADMAP v2: Priority-Ranked Model Improvements

Date: 2026-06-05  
Related report: `docs/reports/model-reliability-assessment.md`

## Goal

Improve the project from a useful Bitcoin forecast visualizer into a better-calibrated forecasting and regime-analysis tool.

Current reliability estimate: **58 / 100**  
Target v2 reliability estimate: **70+ / 100 for context and 14-30 day probabilistic forecasts**

The order below is intentionally priority-ranked. Do the work in P0 first. Do not start P2 model complexity until P0 validation and P1 data foundations exist.

## Priority Summary

| Priority | Workstream | Why It Comes Here |
| --- | --- | --- |
| P0 | Reproducible backtests and calibration | Required to know whether anything improves. |
| P1 | Public regime data and feature table | Highest chance to improve accuracy beyond price-only forecasts. |
| P2 | Model upgrades and trust UI | Useful only after validation and data are in place. |
| P3 | Automation, polish, and deferred experiments | Important, but not the main accuracy unlock. |

## PRD Map

Implementation PRDs live under `docs/PRDs/v2/`.

| Priority | PRD | Scope |
| --- | --- | --- |
| P0 | `01-backtest-quality-lock.md` | Backtest command, benchmark models, persisted reports, model config registry. |
| P0 | `02-horizon-calibration.md` | Horizon-specific interval calibration and probability/scenario labeling. |
| P1 | `03-regime-data-feature-pipeline.md` | On-chain data first, then lag-safe feature table, derivatives, ETF, and macro data. |
| P2/P3 | `04-regime-model-ui-automation.md` | Regime model, ensemble/tail-risk gates, trust UI, and later automation guardrails. |

Ordering rule: implement the PRDs in numeric order. Inside each PRD, complete phases in priority order and do not enable model/UI features until the backtest and ablation gates pass.

## P0: Must Do First

### P0.1 Build A Reproducible Backtest Harness

Purpose: make every future model/data change measurable.

Tasks:

- [ ] Add `scripts/backtest-forecast.ts`.
- [ ] Add `npm run backtest`.
- [ ] Measure median error, bias, NLL, quantile loss, and interval coverage.
- [ ] Test horizons: `7, 14, 30, 60, 90, 180, 365`.
- [ ] Test rolling holdout windows, not only one fixed `2022-01-01` holdout.
- [ ] Include deterministic seeds for Monte Carlo or simulation-based metrics.

Likely files:

- `scripts/backtest-forecast.ts`
- `package.json`
- `src/lib/powerLaw.ts`
- `src/lib/data.ts`
- `src/data/btc-history.json`

Acceptance criteria:

- `npm run backtest` produces deterministic JSON and Markdown outputs.
- Current power-law model is compared against naive/current-price, GBM, and trend baselines.
- The report includes dataset last date, git commit hash, model config, and command used.

### P0.2 Persist Calibration Reports

Purpose: preserve before/after evidence.

Tasks:

- [ ] Create `docs/reports/results/`.
- [ ] Write machine-readable backtest JSON per run.
- [ ] Write human-readable Markdown summaries per run.
- [ ] Add a latest summary file for the UI or docs to reference.

Likely files:

- `docs/reports/results/*.json`
- `docs/reports/results/*.md`
- `scripts/backtest-forecast.ts`

Acceptance criteria:

- Running the backtest creates a timestamped result and updates a latest result.
- Reports can be compared across model versions.

### P0.3 Calibrate Forecast Intervals By Horizon

Purpose: fix probability bands before adding new signals.

Current issue:

- 14-30 day bands are acceptable but conservative.
- 60+ day bands are heavily over-covered, often near 100% coverage.

Tasks:

- [ ] Fit separate interval multipliers for `7, 14, 30, 60, 90, 180, 365`.
- [ ] Evaluate 80%, 90%, and 95% interval coverage independently.
- [ ] Separate median forecast logic from interval-width calibration.
- [ ] Keep long-horizon outputs wide when warranted, but stop presenting trivially over-wide bands as precise probabilities.

Likely files:

- `src/lib/data.ts`
- `scripts/backtest-forecast.ts`
- Optional: `src/lib/modelConfig.ts`

Acceptance criteria:

- 14-90 day interval coverage is within roughly +/- 5 percentage points of target.
- 180-365 day coverage is reported honestly, even if still scenario-level.
- UI language can distinguish "forecast interval" from "scenario range".

### P0.4 Move Model Constants Into Config

Purpose: make experiments auditable.

Tasks:

- [ ] Add a model config module or JSON file.
- [ ] Move power-law coefficients, residual tau, volatility blend, and stress multipliers out of scattered implementation code.
- [ ] Include config version in backtest outputs.

Likely files:

- `src/lib/modelConfig.ts`
- `src/lib/powerLaw.ts`
- `src/lib/data.ts`
- `scripts/analyze-heatmap-model.ts`
- `scripts/backtest-forecast.ts`

Acceptance criteria:

- Backtest output states exactly which model config was evaluated.
- No hidden constants are required to reproduce a forecast.

## P1: Highest Accuracy Upside

### P1.1 Expand CoinMetrics On-Chain Data

Purpose: move beyond price-only modeling with the most natural extension to the existing MVRV pipeline.

Suggested fields:

- Realized cap and realized price.
- MVRV raw source values.
- Active addresses.
- Transaction count.
- Transfer value.
- Fees paid.
- Hash rate.
- Difficulty.
- Miner revenue.
- Supply/profit/loss metrics if available in the public tier.

Tasks:

- [ ] Create `src/data/onchain-history.json`.
- [ ] Add `scripts/update-onchain-data.mjs`.
- [ ] Add `scripts/validate-onchain-data.mjs`.
- [ ] Normalize all rows to UTC dates.
- [ ] Track missing dates and source lag explicitly.
- [ ] Update `.env.example` only if API-key support becomes required.

Acceptance criteria:

- On-chain data can be updated and validated independently.
- The validation script catches gaps, duplicate dates, invalid numeric values, and source lag.
- Backtest can run with and without on-chain features.
- New large history files are not imported into the UI bundle until the UI needs summarized data.

### P1.2 Build A Regime Feature Table

Purpose: convert raw data into lagged, testable features.

Candidate features:

- Price residual versus power-law base.
- Residual momentum over 7/30/90 days.
- Realized-price distance.
- MVRV level and MVRV percentile.
- Rolling MVRV z-score using expanding and rolling windows.
- Hash-rate/difficulty miner-stress proxy.
- Volatility regime: low/medium/high.
- Drawdown from cycle high.

Tasks:

- [ ] Add a feature builder script.
- [ ] Generate a daily feature table from BTC, MVRV, and on-chain history.
- [ ] Lag every feature correctly to prevent lookahead bias.
- [ ] Add feature ablation support to `npm run backtest`.

Likely files:

- `scripts/build-feature-table.ts`
- `src/data/features-history.json`
- `scripts/backtest-forecast.ts`
- `src/lib/powerLaw.ts`
- `src/lib/cycle.ts`

Acceptance criteria:

- Feature table can be regenerated from source data.
- Backtest can run with and without each feature group.
- Feature ablation results are documented.

### P1.3 Add Derivatives Leverage Data

Purpose: improve short-horizon crash/squeeze and volatility-risk detection.

Suggested fields:

- BTC futures open interest.
- Funding rates.
- Liquidations.
- Long/short ratio.
- Options implied volatility if available.

Tasks:

- [ ] Choose a stable source and document rate limits/API-key requirements.
- [ ] Create `src/data/derivatives-history.json`.
- [ ] Add update and validation scripts.
- [ ] Add daily open-interest and funding features first.
- [ ] Backtest impact at 7-30 day horizons before adding more fields.

Acceptance criteria:

- Derivatives data has source attribution and freshness metadata.
- At least one derivatives feature is included in ablation results.

### P1.4 Add ETF Flow Data

Purpose: capture the post-2024 demand channel that older Bitcoin cycle models cannot see.

Suggested fields:

- Daily net BTC ETF flow.
- Cumulative net flow.
- Total BTC ETF AUM.
- Flow as percentage of spot volume.

Tasks:

- [ ] Choose a reproducible source.
- [ ] Create `src/data/etf-flow-history.json`.
- [ ] Add update and validation scripts.
- [ ] Backtest feature value only from 2024 onward.

Acceptance criteria:

- ETF flow data is reproducible and source-attributed.
- The report explains whether ETF features improve post-2024 holdout behavior.

### P1.5 Add Macro Liquidity Data

Purpose: add risk-on/risk-off context for medium and long horizons.

Suggested fields:

- Fed balance sheet: `WALCL`.
- Effective federal funds rate.
- 10-year Treasury yield.
- High-yield credit spread.
- Dollar index or broad liquidity proxy.
- M2 or global liquidity proxy.

Tasks:

- [ ] Create `src/data/macro-history.json`.
- [ ] Add `FRED_API_KEY` support in `.env.example`.
- [ ] Align weekly/monthly macro series to daily rows using last-known value.
- [ ] Avoid lookahead bias by respecting publication dates where possible.

Acceptance criteria:

- Macro data is available as lagged daily features.
- Backtest report includes a macro-feature ablation.

## Cross-Cutting Risks

- `scripts/update-btc-data.mjs` currently updates both BTC OHLCV and MVRV as part of `predev`; preserve that behavior or split it deliberately.
- New `src/data/*.json` files can increase the Vite bundle if imported directly. Prefer report-only artifacts, summarized runtime data, or lazy loading before adding large UI imports.
- `package-lock.json` and `yarn.lock` both exist. Choose one canonical package manager before CI automation.
- The UI model selector includes placeholder-like options while only `powerlaw` has differentiated logic. Trust-focused UI work should demote or clearly label unvalidated model choices.

## P2: Model And Product Upgrades

### P2.1 Refit And Stress-Test Power-Law Coefficients

Purpose: test whether hardcoded coefficients are stable.

Tasks:

- [ ] Add a script to refit power-law coefficients.
- [ ] Use only data available before each rolling-origin date.
- [ ] Measure coefficient stability over time.
- [ ] Report uncertainty around coefficients.

Acceptance criteria:

- Report shows whether fixed coefficients are stable enough to keep.
- Long-horizon UI language is adjusted if coefficient uncertainty is large.

### P2.2 Replace Fixed Cycle Timing With Probabilistic Regime State

Purpose: stop treating ATH/ATL timing constants as forecast facts.

Candidate states:

- Accumulation/value.
- Trend expansion.
- Late-cycle overheating.
- Deleveraging/bear.
- Sideways/chop.

Inputs:

- Power-law residual.
- MVRV/realized-price distance.
- Volatility regime.
- Funding/open-interest state.
- Macro liquidity trend.
- ETF flow trend.

Outputs:

- State probabilities.
- State-specific drift/residual behavior.
- State-specific interval width.

Acceptance criteria:

- Probabilistic regime model beats fixed phase labels out of sample.
- Existing cycle phase UI is relabeled as context or replaced.

### P2.3 Build A Simple Ensemble Forecast

Purpose: reduce single-model dependence without creating an opaque system.

Candidate ensemble members:

- Power-law mean reversion.
- Naive/current price baseline.
- GBM baseline.
- Trend baseline.
- Regime-adjusted residual model.

Tasks:

- [ ] Start with validation-weighted averaging.
- [ ] Report member weights per horizon.
- [ ] Compare ensemble against best single model.

Acceptance criteria:

- Ensemble beats the current power-law baseline at one or more key horizons without worsening calibration.

### P2.4 Add A Tail-Risk Overlay

Purpose: model crash/squeeze risk separately from median price.

Inputs:

- Funding extremes.
- Open interest growth.
- Realized volatility jumps.
- Liquidation history.
- Macro stress.

Outputs:

- Elevated downside-risk flag.
- Elevated upside-squeeze flag.
- Wider interval adjustment.

Acceptance criteria:

- Tail-risk flags are backtested against large forward moves.
- UI labels are descriptive, not overconfident.

### P2.5 Add Trust And Explainability UI

Purpose: make model limits obvious to users.

Tasks:

- [ ] Add a model reliability panel.
- [ ] Show latest backtest score.
- [ ] Show horizon-specific confidence.
- [ ] Show dataset freshness.
- [ ] Label forecast modes clearly: "Median path", "Scenario range", "Historical power-law band", "Regime context".
- [ ] Add a "why this forecast moved" panel.
- [ ] Add long-horizon caveats for 180-365 day forecasts.

Likely files:

- `src/App.tsx`
- `src/components/Chart.tsx`
- `src/lib/data.ts`
- `src/lib/api.ts`
- New UI component files as needed

Acceptance criteria:

- Users can see data freshness and model reliability without reading source code.
- Long-horizon forecasts are visibly framed as scenarios.

## P3: Automation, Polish, And Deferred Work

### P3.1 Scheduled Updates And Release Gates

Tasks:

- [ ] Add scheduled data update workflow.
- [ ] Add scheduled backtest/report generation.
- [ ] Fail builds when data validation fails.
- [ ] Store previous reports for trend comparison.
- [ ] Add alert if latest source data is stale.

Acceptance criteria:

- Deployment never silently ships stale or invalid data.
- A current model report is always available.
- Backtest score changes are visible before release.

### P3.2 Sentiment Data

Suggested fields:

- Alternative.me Fear & Greed Index.
- Google Trends, if source and history are stable enough.

Why P3:

- Sentiment is useful context, but likely lower accuracy impact than on-chain, derivatives, ETF flows, and macro liquidity.

Acceptance criteria:

- Sentiment is source-attributed and treated as context until it proves forecast value.

### P3.3 Market Data Quality Upgrade

Tasks:

- [ ] Evaluate exchange-specific OHLCV from Coinbase, Kraken, or Binance where appropriate.
- [ ] Evaluate aggregate spot volume from a consistent vendor.
- [ ] Store raw-source snapshots or enough metadata to detect vendor-methodology shifts.
- [ ] Keep a clear UTC daily close convention.

Why P3:

- Current data is good enough for visualization and baseline model work. Better OHLCV is valuable, but not the first accuracy bottleneck.

### P3.4 Deferred Experiments

Do not prioritize yet:

- Neural-network forecasting.
- Complex deep-learning sequence models.
- Paid/vendor-locked data before public-source improvements are exhausted.
- Exact long-horizon target-price UI.
- Cycle phase as alpha unless it beats the baseline out of sample.

## Target Metrics For v2

| Metric | Current | v2 Target |
| --- | ---: | ---: |
| Overall reliability estimate | 58 / 100 | 70+ / 100 |
| 14d median multiplicative error | ~7% | <= 6% |
| 30d median multiplicative error | ~11% | <= 9% |
| 90d median multiplicative error | ~18% | <= 15% |
| 80% interval coverage | over-covered after 30d | 75-85% |
| 90% interval coverage | over-covered after 30d | 85-95% |
| 95% interval coverage | over-covered after 30d | 92-98% |
| Report reproducibility | manual scripts | one command |
| External regime data | MVRV only | on-chain + derivatives + ETF + macro |

## Definition Of Done For v2

v2 is done when:

- Backtests are reproducible with one command.
- Forecast intervals are calibrated by horizon.
- The app has at least one validated non-price regime feature.
- New signals are documented with ablation results.
- The UI shows model reliability and data freshness.
- Long-horizon outputs are clearly framed as scenarios.

## Expected Result

The model should become more reliable as a regime-aware probabilistic visualizer. It still should not be marketed as a trading oracle. A strong v2 should answer:

- Is Bitcoin stretched or cheap versus its own history?
- Is leverage making near-term downside or upside risk worse?
- Are ETF/macro/on-chain conditions supporting or contradicting the price trend?
- How wide should the uncertainty range be at each horizon?
- Did a new model version actually beat the old one out of sample?
