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

## 2026-07-10 — Yellow forecast-path horizon prefix stability

Status: `completed — prefix invariant passed; statistical gate needs more data; report-only`

### Hypothesis

The yellow stochastic forecast path can be made consistent across horizon changes by deriving its random stream from stable forecast identity—asset, origin, data/configuration version, generator method, and trace index—while using horizon only as the requested sequence length. Then a longer horizon will extend the shorter path instead of redrawing it, without smoothing the path or degrading its statistical properties.

### Data/source changes

None. Use checked-in BTC, VOO, and GLD histories. No source, median model, interval model, channel model, heatmap model, or external data change is authorized.

### Validation setup

- PRD: `docs/PRDs/YELLOW_LINE_HORIZON_PREFIX_STABILITY.md`.
- Baseline diagnosis: BTC seeds stochastic traces with `horizon * 131`; S&P 500/gold use `horizon * 97`; gold also selects a primary trace by scoring the entire requested horizon. These mechanisms make shared prefixes horizon-dependent.
- Candidate: versioned per-trace seeds derived without horizon, stable per-trace/day random consumption, and a gold primary-selection rule based on a frozen fixed prefix or trace identity.
- Compare supported pairs including at least 30→90, 90→180, and 180→365 days across rolling origins for all three assets.
- Primary invariant: zero mismatched dates or primary-trace values in the shared prefix, within `1e-12` relative tolerance, regardless of navigation order or direct generation.
- Safety metrics: terminal q10/q50/q90 pinball, 80/90/95 coverage, NLL where defined, drawdown depth/duration, realized volatility, sign-change rate, tails, residual autocorrelation, absolute-return autocorrelation, support breaches, continuity, and invalid values.
- Promotion requires prefix invariance plus statistical non-inferiority under the v2.12 path tolerances, no more than 2 percentage points of coverage loss, no material pinball/NLL regression, and passing `npm run backtest`, `npm run backtest:market`, tests, typecheck, build, E2E, and manual visual review.
- Verdicts are asset-specific. A BTC pass cannot enable S&P 500 or gold, and vice versa.

### Report artifacts

- Planning artifact: `docs/PRDs/YELLOW_LINE_HORIZON_PREFIX_STABILITY.md`.
- Baseline artifacts: `docs/reports/results/forecast-path-prefix-baseline-2026-07-10.md` and `.json`.
- Candidate artifacts: `docs/reports/results/forecast-path-prefix-candidate-2026-07-10.md` and `.json`.
- Reproduction: `npm run analyze:forecast-path-stability -- --baseline` and `npm run analyze:forecast-path-stability -- --candidate prefix-stable-v1`.

### Result / verdict

Verdict: `needs-more-data`; keep production routing on the baseline generator. The baseline report reproduces shared-prefix mismatches for BTC, S&P 500, and gold across 30→90, 90→180, and 180→365. The frozen `prefix-stable-v1` candidate records zero mismatches for all nine asset/pair comparisons and uses per-trace identity seeds plus a 14-day gold selection window. This proves the invariance property, but the current artifact evaluates one origin per asset and does not establish rolling-origin terminal distribution, coverage, pinball/NLL, drawdown, volatility, tail, or autocorrelation non-inferiority. Phase 3 runtime enablement is therefore prohibited; the candidate remains reachable only through an explicit report/test option.

### Rerun criteria

Rerun `prefix-stable-v1` on a pre-registered rolling-origin cohort with the full v2.12 path diagnostics and applicable backtests. Otherwise rerun only for a new generator version, a materially changed accepted path model, a new origin/data cohort, or a distinct pre-registered selection mechanism. Do not tune seeds or gold selection windows against already-inspected visual outcomes.

### Next better experiment

Extend the analyzer to rolling origins and paired baseline/candidate terminal/path diagnostics, freeze tolerances from v2.12, then run both forecast backtests. Promote assets independently only if those statistical gates pass; otherwise retain the baseline limitation.

---

## 2026-07-10 — S&P 500 and gold forecast-channel path calibration

Status: `planned — report-only until validated`

### Hypothesis

The current S&P 500 and gold upper/lower future channel paths are straight on the logarithmic chart because they freeze the latest historical residual quantiles and compound a constant daily drift. Origin-safe pointwise quantiles from moving-block simulated price paths may improve future-path interval score and preserve nominal coverage without excessive width. A less-straight appearance is not evidence and is not a promotion criterion.

BTC uses separate power-law floor/peak paths. This experiment will audit BTC invariance but will not change BTC runtime output, styling, or forecast behavior.

### Data/source changes

None. Use the checked-in VOO and GLD adjusted daily OHLCV histories and the existing BTC history for invariance tests. No source, instrument, feature, median model, or production data change is authorized.

### Validation setup

- PRD: `docs/PRDs/MARKET_FORECAST_CHANNEL_PATHS.md`.
- Baseline: current frozen-residual, constant-drift future channel.
- Primary candidate: deterministic moving-block bootstrap of origin-safe empirical innovations, summarized as pointwise future-price quantiles. Any volatility-regime candidate must be separately frozen before its results are inspected.
- Evaluate S&P 500 and gold independently with rolling origins, at least 1,000 training rows, 30/90/180-session leads, intermediate lead buckets, and an untouched outer holdout after inner parameter selection.
- Primary metric: paired pointwise interval-score improvement. Secondary metrics: q05/q95 pinball loss, 90% coverage, log-width, width growth, origin continuity, inversions/non-finite values, and regime robustness.
- Dependence/multiplicity: paired block bootstrap with horizon-aware blocks, non-overlapping-equivalent sample counts, and correction across assets/horizons.
- Default promotion gate: at least 30 nominal non-overlapping outer outcomes per promoted horizon; at least 2% interval-score improvement with a positive corrected 95% lower bound; q05/q95 pinball loss no material regression; 85–95% coverage with no more than 2 percentage-point loss versus baseline; width inflation no more than 10% absent significant correction of undercoverage; zero invalid/discontinuous paths; stable neighboring parameters and regimes.
- Curvature and direction changes are diagnostics only. They cannot promote a candidate.
- Required regression checks before any runtime change: `npm run backtest:market`, `npm run backtest`, `npm test -- --run`, `npm run lint`, `npm run build`, and chart E2E/manual review.

### Report artifacts

- Planning artifact: `docs/PRDs/MARKET_FORECAST_CHANNEL_PATHS.md`.
- Planned baseline artifacts: `docs/reports/results/market-channel-path-baseline-YYYY-MM-DD.md` and `.json`.
- Planned candidate artifacts: `docs/reports/results/market-channel-path-candidates-YYYY-MM-DD.md` and `.json`.
- No result artifacts exist yet; this entry registers the experiment before implementation or result inspection.

### Result / verdict

Pending. Current diagnosis is algebraic: for each future day, `log(bound) = log(latestTrend) + drift * day + frozenResidualQuantile`, which must draw as a straight line on the logarithmic price scale. This explains the appearance but is not evidence that an alternative model is better. Keep all runtime forecasts and UI paths unchanged until the registered validation gate passes.

### Rerun criteria

Rerun after the first frozen baseline/candidate evaluation only for a genuinely new outer-holdout cohort, a material source/methodology change with a new availability audit, or a distinct pre-registered channel mechanism. Do not search neighboring bootstrap parameters on an already inspected holdout.

### Next better experiment

Build the origin-safe baseline report first. Then evaluate exactly the pre-registered moving-block pointwise-quantile candidate. If it fails calibration or proper-scoring gates, retain the current channel and improve semantic labeling/documentation rather than adding cosmetic curves.

---

## 2026-07-10 — BTC forecast-line capability research program

Status: `completed — YL-1/YL-2 rejected; YL-2P rejected for calibration; prospective study needs more data`

### Hypothesis

The BTC forecast distribution can improve at 14/30/60/90-day horizons by first removing point-in-time benchmark leakage and then testing a small, pre-registered portfolio of causal structural and residual models. A nested structural power-law refit or local-level/state-space residual model may reduce medium-horizon absolute log error without degrading interval calibration.

The prominent jagged yellow chart path is currently built from a seeded stochastic trace. Its existing jagged shape, styling, prominence, and rendering behavior must remain unchanged; this program does not authorize replacing it with a smooth median line. Accuracy evidence comes from explicit out-of-sample metrics rather than visual smoothness.

The retained noise must be statistically relevant rather than decorative. Candidate YL-2P will test point-in-time moving-block, volatility-regime-conditioned, and state-space innovation generators for residual dependence, volatility clustering, tails, drawdowns, sign changes, realized-volatility distribution, and terminal quantile calibration. The same origin/config seed must reproduce the same path.

### Data/source changes

No new source is planned initially. Use checked-in daily UTC BTC OHLCV plus existing lag-safe feature caches where a later, explicitly scoped candidate requires them.

Required methodology changes before candidate evaluation:

- Refit structural coefficients using only data available by each forecast origin.
- Fit interval/calibration state only from forecast errors whose targets have matured by that origin.
- Purge supervised rows whose `targetDate` is not earlier than the evaluation origin and apply horizon-aware embargoes.
- Freeze candidate definitions, grids, seeds, metrics, and stopping rules before prospective confirmation.

### Validation setup

PRD: `docs/PRDs/v2/12-yellow-line-forecast-capability.md`.

- Foundation: nested point-in-time rolling-origin benchmark against the current policy, naive current price, GBM driftless/recent drift, and MA trend.
- Candidates, in order: YL-1 nested structural refit with shrinkage; YL-2 local-level/state-space residual dynamics; YL-2P statistically calibrated jagged-path innovations; YL-3 a single manually reviewed horizon-scoped COT residual only when fresh sample size permits; YL-4 a simple regime mixture only if YL-1 or YL-2 first passes development evidence.
- Horizons: 14/30/60/90d.
- Primary metric: paired mean absolute log-error improvement.
- Secondary: median absolute log error, bias, direction hit rate, q10/q50/q90 pinball loss, NLL, 80/90/95 coverage, and interval width.
- YL-2P path metrics: innovation mean/variance, residual and absolute-return autocorrelation, volatility clustering, tail quantiles, drawdown depth/duration, sign-change rate, realized-volatility distribution, and terminal calibration. Passing path validity does not imply improved median accuracy.
- Dependence/multiplicity: moving-block bootstrap with block length at least the horizon; Holm correction across candidates and horizons.
- Default practical gate: at least 2% relative MALE improvement at a promoted 30/60/90d horizon, no worse than 0.5% regression elsewhere, positive 95% lower bound after correction, no coverage loss over 2 percentage points, no material pinball/NLL regression, parameter/regime robustness, and at least 30 nominal non-overlapping prospective outcomes per promoted horizon.
- The repeatedly inspected 2022+ and 2025+ periods are development diagnostics only. Promotion requires a frozen append-only prospective forecast ledger and pre-registered stopping rule.
- Required regression commands after any proposed promotion: `npm run backtest`, `npm test -- --run`, `npm run lint`, and `npm run build`.

### Report artifacts

- Planning artifact: `docs/PRDs/v2/12-yellow-line-forecast-capability.md`.
- Rendering/scoring contract: `docs/reports/results/README.md` and the exact named chart regression tests.
- YL-0 point-in-time benchmark: `docs/reports/results/point-in-time-core-2026-07-10T19-52-43-293Z.json` and `.md`.
- YL-1 structural shrinkage: `docs/reports/results/point-in-time-structural-shrinkage-2026-07-10T20-07-07-288Z.json` and `.md`.
- YL-2 state-space residual: `docs/reports/results/point-in-time-state-space-residual-2026-07-10T20-06-58-771Z.json` and `.md`.
- YL-2P calibrated jagged path: `docs/reports/results/point-in-time-calibrated-jagged-path-2026-07-10T20-08-24-434Z.json` and `.md`.
- Prospective protocol and empty append-only ledger: `docs/reports/results/yellow-line-prospective-protocol.md` and `src/data/prospective-forecast-ledger.json`.

Reproduction and regression commands:

- `npm run backtest:pit-core`
- `npm run backtest:pit-core -- --candidate structural-shrinkage`
- `npm run backtest:pit-core -- --candidate state-space-residual`
- `npm run backtest:pit-core -- --candidate calibrated-jagged-path`
- `npm run evaluate:prospective-forecast`
- `npx vitest run src/components/__tests__/Chart.component.test.tsx src/components/__tests__/Chart.test.ts src/lib/__tests__/pointInTimeForecast.test.ts src/lib/__tests__/stateSpaceResidual.test.ts src/lib/__tests__/prospectiveLedger.test.ts`

### Result / verdict

Verdict: `rejected / needs more data`; keep the production median and displayed yellow path unchanged.

- Phase 1 preservation contract passed: the primary amber `LineSeries` still receives deterministic `stochasticTraces[0]`, forecast candles retain the anchored opposite-sign jagged fixture, and the smooth q50 remains opt-in. Focused chart tests passed 9/9 and the production build passed. No chart runtime file changed.
- YL-0 passed as a methodology foundation. The final full artifact contains 458 origin/horizon rows, strict origin-close structural fits, calibration targets strictly before each origin, horizon embargo metadata, per-origin hashes/commit/seeds/skips, and all five benchmarks on the same schedule. Future-price mutation tests cover all earlier origins, including targets crossing the mutation boundary.
- YL-1 was rejected at the development gate. Relative MALE changes at 14/30/60/90d were `-0.09%/-0.20%/-0.27%/-0.29%`; Holm-adjusted p-values were `1.0`; every reported regime had negative paired improvement; mean pinball loss also regressed. The candidate never met the 2% effect or statistical/calibration gates.
- YL-2 was rejected decisively. Relative MALE changes were `-22.67%/-19.53%/-12.00%/-10.16%`; Holm-adjusted p-values were `1.0`; pinball and coverage regressed, and 60/90d signs reversed between 2025+ and older regimes. No neighboring state-space parameters may be searched on these outcomes.
- YL-2P kept q50 unchanged and was rejected for path/distribution promotion. Its horizon-scaled terminal simulations worsened mean pinball and lost more than two coverage points at every gated horizon. Generated realized-volatility quantiles were materially below the origin-safe source distribution. This is not a statistically accepted replacement for the current visible generator.
- Candidate selection used six frozen inner walk-forward folds with targets before each outer origin, a minimum 1,460-row training window, frozen grids/seeds/failure behavior, moving-block intervals, Holm correction, regime/sensitivity checks, per-path diagnostics, terminal quantiles, pinball/NLL/coverage/width, and deterministic content hashes. The 2017-2021, 2022-2024, and 2025+ slices are labeled development robustness evidence, never clean confirmation.
- The prospective protocol is implemented but has no eligible candidate to freeze. The hash-bound ledger is intentionally empty; `npm run evaluate:prospective-forecast` returns `needs more data`, 0/30 non-overlapping outcomes, and suppresses interim comparative scores.
- No candidate is enabled. `YELLOW_LINE_FORECAST_CONFIG.enabled=false`; runtime routing explicitly remains `production-baseline`, and enabled configurations without exact evidence/config hashes are rejected.

Existing negative evidence remains binding: do not revive neighboring fixed-tau searches, the expanding AR(1) diagnostic, kitchen-sink ridge, generic ETF-flow adjustment, or generic funding/premium median adjustment on already-inspected history.

### Rerun criteria

Do not rerun YL-1, YL-2, or YL-2P parameter neighborhoods on the same history. Candidate reruns require one of:

1. A materially changed accepted baseline or structural specification.
2. A genuinely new prospective confirmation cohort reaching the pre-registered stopping rule.
3. A documented data/source methodology change with a fresh point-in-time audit.
4. A distinct causal mechanism pre-registered before its outcomes are inspected.

Do not rerun rejected parameter neighborhoods on the same evaluation window.

### Next better experiment

Stop median-model complexity because both pre-registered median candidates failed. Keep the production baseline and current visible generator. The next better experiment is a distinct, newly pre-registered mechanism or a new point-in-time data source with an availability audit; do not freeze prospective candidate rows until such a candidate passes the development gate. Continue the empty protocol/ledger integrity checks without inspecting or fabricating outcomes.

---

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

## 2026-08-02 — FRED stress interval ablation

Status: `needs-rerun — authenticated BTC-era cache unavailable; repaired runner requires a fresh run`

Arm id: `stress-interval`

### Hypothesis

The point-in-time average of high-yield spread, NFCI, VIX, Baa spread, dollar momentum, and inverted yield curve identifies stressed origins where widening the current power-law interval improves log-score/NLL without moving the median.

### Data/source changes

The experiment registers an authenticated FRED observations API cache from `2010-07-17` with `WALCL`, `FEDFUNDS`, `DGS10`, `BAMLH0A0HYM2`, `M2SL`, `T10Y2Y`, `NFCI`, `VIXCLS`, `BAA10Y`, and `DTWEXBGS`. Rows use latest FRED revisions, per-series observed dates, and a conservative 30-day `availableAfter` rule. The local refresh was attempted with `yarn update:macro` and was blocked by the sandbox network before a response; the pre-existing cache remains a 2023+ legacy cache and is not evidence for the required BTC-era coverage.

### Validation setup

Script: `scripts/backtest-fred-macro-experiments.ts` via `yarn backtest:fred-macro`.

- Baselines: `powerlaw-current` and `naive-current-price`.
- Validation: `2018-01-01 → 2022-12-31`; final holdout: `2023-01-01 → latest complete target`.
- Horizons: `14/30/60/90d`; daily origins plus horizon-spaced robustness.
- Parameter grid: interval scales `0/0.1/0.2/0.35/0.5/0.75`, selected on validation only.
- Metrics: NLL, mean/median absolute log error, 90% coverage, q05/q95 log pinball, paired 2,000-iteration horizon-length moving-block bootstrap, and Holm correction across three arms and four horizons.

### Report artifacts

- `docs/reports/results/btc-fred-macro-experiments.json`
- `docs/reports/results/btc-fred-macro-experiments.md`

### Result / verdict

Verdict: `needs-rerun` / `needs more data`. The authenticated FRED BTC-era cache could not be fetched in this environment, and the available local cache has no 2018/2020/2022 rows. The repaired runner correctly leaves all parameters unselected, does not score a zero-effect candidate, and requires a fresh run before any experiment claim. No production forecast path changed.

### Rerun criteria

1. `yarn update:macro` succeeds with a real `FRED_API_KEY` and the cache contains rows covering 2018, 2020, and 2022.
2. Re-run the exact validation/holdout split with no parameter selection after `2023-01-01`.
3. Repeat with ALFRED vintages and publication/revision dates before considering any promotion.

### Next better experiment

Run the same stress interval ablation on a vintage-safe ALFRED cache with the stress threshold frozen before the new holdout. Keep the signal context-only until the corrected holdout gate passes.

---

## 2026-08-02 — FRED liquidity median ablation

Status: `needs-rerun — authenticated BTC-era cache unavailable; repaired runner requires a fresh run`

Arm id: `liquidity-median`

### Hypothesis

A point-in-time liquidity composite from Fed balance-sheet growth, M2 growth, fed-funds change, yield-curve change, and dollar momentum shifts the current power-law log median enough to improve endpoint accuracy without degrading calibrated intervals.

### Data/source changes

Uses the authenticated ten-series FRED observations cache, latest revised observations, per-series `observedDates`, and 30-day `availableAfter` lag described in the shared FRED experiment report. The required refresh could not reach the FRED host in this sandbox, so the existing cache is insufficient for a valid 2018–2022 validation claim.

### Validation setup

The runner selects the liquidity coefficient from `[-0.1, -0.05, 0, 0.05, 0.1]` on `2018-01-01 → 2022-12-31` only, then scores the untouched `2023-01-01+` holdout at `14/30/60/90d` against `powerlaw-current` and `naive-current-price`. It reports NLL, absolute log error, pinball loss, 90% coverage, horizon-length block-bootstrap uncertainty, Holm-adjusted p-values, and horizon-spaced robustness.

### Report artifacts

- `docs/reports/results/btc-fred-macro-experiments.json`
- `docs/reports/results/btc-fred-macro-experiments.md`

### Result / verdict

Verdict: `needs-rerun` / `needs more data`. The authenticated FRED BTC-era cache could not be fetched in this environment, so the cache coverage gate failed before a meaningful validation comparison could be made. The repaired runner does not select parameter zero or score an absent-signal candidate; it requires a fresh run. Latest-revised FRED data is explicitly research-only, and the production median remains unchanged.

### Rerun criteria

1. Refresh the cache successfully with authenticated FRED API observations spanning the BTC era.
2. Select the coefficient before the holdout and require positive corrected out-of-sample evidence with no median-error regression.
3. Re-run on ALFRED vintages before treating a positive result as more than research-only.

### Next better experiment

Use a frozen, vintage-safe liquidity composite and compare the median shift against a no-shift baseline on a newly accumulated holdout, with coefficient sign and magnitude selected only in the historical validation window.

---

## 2026-08-02 — FRED stress shock interval ablation

Status: `needs-rerun — authenticated BTC-era cache unavailable; repaired runner requires a fresh run`

Arm id: `shock-interval`

### Hypothesis

A positive 30-day shock in the point-in-time stress composite, above a pre-registered one-standard-deviation threshold, identifies origins where widening only the forecast interval improves tail calibration.

### Data/source changes

Uses the authenticated FRED observations API loader and the same ten public series as the other two arms. Stress-change z-scores use prior rows only; the current macro observation is excluded from its own rolling mean and variance. The local network could not complete the refresh, leaving the legacy 2023+ cache in place for this run.

### Validation setup

The runner selects the interval multiplier from `0/0.1/0.2/0.35/0.5/0.75` using validation NLL only, then evaluates the untouched holdout at `14/30/60/90d` with daily and horizon-spaced origins. The report includes paired effect sizes, 2,000 moving-block bootstrap intervals, Holm correction, 90% coverage, q05/q95 pinball, and the median-error guardrail.

### Report artifacts

- `docs/reports/results/btc-fred-macro-experiments.json`
- `docs/reports/results/btc-fred-macro-experiments.md`

### Result / verdict

Verdict: `needs-rerun` / `needs more data`. The authenticated FRED BTC-era cache could not be fetched in this environment, so no usable 2018/2020/2022 validation signal was available. The repaired runner leaves the shock parameter unselected, does not score a zero-effect candidate, and requires a fresh run. No production interval or UI behavior changed.

### Rerun criteria

1. Successfully refresh the ten-series cache with `FRED_API_KEY` and verify 2018, 2020, and 2022 rows.
2. Freeze the shock threshold and multiplier selection before the `2023-01-01` holdout.
3. Repeat with ALFRED vintages and reject any candidate that fails corrected daily or horizon-spaced robustness.

### Next better experiment

Test the frozen shock definition on vintage-safe observations with a new holdout, then compare a single widening rule against a no-shock negative control before considering any app integration.

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

## 2026-07-09 — Fixed-tau 120 replication with dependence and multiplicity controls

Status: `completed — rejected (pre-specified replication protocol)`

### Hypothesis

Conditioned on the app's existing static power-law curve, shortening residual mean reversion from `tau=210` days to the single pre-specified replication candidate `tau=120` days reduces endpoint forecast mean absolute log error at `14/30/60/90d` without materially degrading probabilistic calibration.

This is a replication/robustness test, not a fresh confirmatory holdout. Prior work already searched tau grids and inspected 2022+ and 2025+ results. The experiment therefore cannot authorize a production change regardless of its result; promotion requires a prospectively frozen forward holdout.

### Data/source changes

No data-source or production-model changes. Use the checked-in daily UTC BTC close history in `src/data/btc-history.json`. Compare only the existing fixed `tau=210` model with the single fixed `tau=120` candidate, holding the power-law curve and interval construction constant.

Known provenance limitation: static power-law coefficients may have been fitted with data later than some historical origins. The paired comparison isolates tau conditional on that curve but is not a fully point-in-time backtest of the entire model.

### Validation setup

Script: `scripts/backtest-tau-replication.ts`

- Baseline: current `powerlaw-current` behavior with `tau=210`.
- Candidate: identical model with fixed `tau=120`; no parameter selection in this run.
- Evaluation window: `2017-01-01` through latest origin with an observed target, reported in full and by `2017-2021`, `2022-2024`, and `2025+` subperiods.
- Horizons: `14/30/60/90d`.
- Primary metric: paired mean absolute log-error improvement, `|log(F_210/Y)| - |log(F_120/Y)|`.
- Secondary metrics: median absolute log error, bias, Gaussian NLL, q10/q50/q90 mean pinball loss, 80/90/95 coverage, and interval width.
- Dependence control: seeded moving-block bootstrap with block length equal to the forecast horizon and 10,000 iterations.
- Multiple testing: one-sided bootstrap p-values across the four primary horizons adjusted by Holm's method.
- Practical gate: at every horizon, at least 30 nominal non-overlapping equivalents, at least 1% relative mean absolute log-error improvement, positive uncentered 95% bootstrap lower bound against zero, Holm-adjusted `p < 0.05` against the stricter 1% practical null, no interval coverage loss greater than 2 percentage points, and no negative mean improvement in any reported origin subperiod.
- Failure criteria: failure of any gate, evidence of future target use, fewer than 30 nominal non-overlapping equivalents, or instability across origin subperiods. Regardless of point results, status remains `research-only` because no untouched final holdout exists.

### Report artifacts

- `docs/reports/results/tau-120-replication-2026-07-09T19-49-42-622Z.md`
- `docs/reports/results/tau-120-replication-2026-07-09T19-49-42-622Z.json`
- `docs/reports/results/backtest-2026-07-09T19-50-25-123Z.md`
- `docs/reports/results/backtest-2026-07-09T19-50-25-123Z.json`

### Result / verdict

Verdict: `rejected`; retain `tau=210`. The apparently promising short-tau result did not replicate over the broader `2017+` window and is too regime-unstable and selection-contaminated to promote.

Across the full pre-specified `2017+` evaluation, `tau=120` worsened mean absolute log error at every gated horizon:

- 14d: `-2.24%` relative improvement; lower95 `-0.004097`; Holm-adjusted `p=1.0`.
- 30d: `-2.66%`; lower95 `-0.008966`; Holm-adjusted `p=1.0`.
- 60d: `-1.94%`; lower95 `-0.012729`; Holm-adjusted `p=1.0`.
- 90d: `-2.43%`; lower95 `-0.019805`; Holm-adjusted `p=1.0`.

The candidate improved paired mean error for origins in `2022-2024` and `2025+`, but worsened origins in `2017-2021` at every horizon (`-0.00521/-0.00936/-0.01172/-0.01656` log-error improvement at 14/30/60/90d). That sign reversal fails the pre-specified origin-subperiod robustness gate. It shows regime instability; it does not rule out a time-varying tau effect.

Coverage deltas stayed within the 2 percentage-point guardrail, but NLL worsened at every horizon. No product, UI, configuration, or production forecast behavior was changed.

Reproduction and regression commands:

- `npm run backtest:tau-replication` — deterministic candidate report, verdict `rejected`.
- `npm run backtest` — quality gate `PASS`; robustness audit `PASS`.
- `npm run lint` — `PASS`.
- `npm test -- --run` — 11 files and 24 tests passed.

Independent role review also found that the current nominal holdouts are not clean: 2025+ has been repeatedly inspected; interval multipliers were calibrated and evaluated on 2022+; static power-law coefficient provenance is retrospective. Separately, residual-model training should purge rows whose `targetDate` is not yet known at the evaluation origin, and feature-family holdout training should purge targets crossing the holdout boundary. These issues further strengthen the no-promotion verdict.

### Rerun criteria

Do not rerun neighboring fixed tau values on the same history. Revisit residual-decay structure only if the baseline power-law curve changes materially or a distinct mechanism is pre-registered. Any promotion claim requires a prospectively frozen forward holdout with at least 30 non-overlapping 90-day outcomes.

### Next better experiment

Retain `tau=210`. The next better core-model experiment is a point-in-time nested walk-forward benchmark that fits structural coefficients and interval calibration using data available before each origin, then freezes a genuinely untouched prospective confirmation period. Do not search neighboring tau values on this evaluation window.

---

## 2026-07-09 — Expanding-window AR(1) residual-decay diagnostic

Status: `completed — rejected, report-only diagnostic`

### Hypothesis

A causal no-intercept expanding AR(1) estimate of the residual around the current power-law base may adapt mean-reversion speed through time and outperform fixed `tau=210` without using future prices.

### Data/source changes

No data or production changes. Use checked-in daily BTC closes and the current static power-law base. At each origin, estimate `phi = sum(r[t-1]r[t]) / sum(r[t-1]^2)` from residual pairs available through the origin, clip to `(0, 0.9999)`, and forecast `r[o+h] = phi^h r[o]`.

### Validation setup

- Report-only specialist diagnostic; not a pre-specified promotion test.
- Origin periods: `2022-2024` and `2025+`.
- Horizons: `14/30/60/90d`.
- Comparators: fixed `tau=120` and `tau=210`.
- Metric: median absolute log error.
- Limitations: already-inspected periods, retrospective structural-base coefficients, and no immutable standalone reproduction command. The result cannot support promotion.

### Report artifacts

- `docs/reports/results/adaptive-ar1-tau-diagnostic-2026-07-09.md`

### Result / verdict

Verdict: `rejected`. The estimator implied an effective tau near `742-750` days and lost to fixed `tau=120` in seven of eight period/horizon cells. It also generally lost to `tau=210` at longer horizons. The near-unit-root estimate likely absorbs structural-base drift and adds estimation variance without forecast benefit.

### Rerun criteria

Rerun only with point-in-time structural-base refitting, a frozen estimator specification and reproducible script, and a genuinely untouched prospective holdout.

### Next better experiment

Do not tune AR bounds or rolling windows on these evaluation slices. First build a nested point-in-time core-model benchmark that removes the static-base provenance problem.

---

## 2026-07-10 — Market channel moving-block candidate evaluation result

Status: `completed — needs-more-data; no runtime promotion`

### Hypothesis

Origin-safe pointwise q05/q95 bounds from moving-block empirical price paths may improve interval score over the frozen-residual channel for VOO and GLD while preserving calibrated coverage, tail loss, width, continuity, and deterministic output.

### Data/source changes

No production source or runtime forecast change. The report uses the checked-in VOO and GLD adjusted daily OHLCV histories. The shared US-session calendar was corrected so Juneteenth is treated as an exchange holiday only from 2022 onward.

### Validation setup

Run `npm run backtest:market -- --channel-path-baseline` and `npm run backtest:market -- --channel-path-candidates`. Origins use at least 1,000 prior rows; the final 40% is treated as outer evaluation; leads are 5/10/20/30/60/90/120/180 sessions. The frozen candidate is a 1,000-simulation, 10-session moving-block bootstrap over 504 origin-available innovations. Inference uses 2,000 paired moving-block bootstrap iterations and Bonferroni correction across two assets and three gated horizons. Seeds include asset, origin, horizon, candidate id, and configuration version. Curvature is diagnostic only.

### Report artifacts

- `docs/reports/results/market-channel-path-baseline-2026-07-10.md`
- `docs/reports/results/market-channel-path-baseline-2026-07-10.json`
- `docs/reports/results/market-channel-path-candidates-2026-07-10.md`
- `docs/reports/results/market-channel-path-candidates-2026-07-10.json`

### Result / verdict

Verdict: `needs-more-data` independently for S&P 500 and gold. The checked-in histories cannot supply 30 nominal non-overlapping outer outcomes at 90 and 180 sessions under the frozen split. Corrected uncertainty and/or coverage also fail at longer horizons. The candidate is therefore research-only even where point estimates improve interval score. Phase 3 runtime integration is not authorized; existing non-BTC channel behavior and all BTC behavior remain unchanged.

### Rerun criteria

Rerun only after enough genuinely new, uninspected observations exist to supply at least 30 non-overlapping outcomes at every promoted horizon, or after a separately pre-registered data extension with audited point-in-time provenance. Do not tune block length, lookback, quantiles, or seeds against these inspected outer results.

### Next better experiment

Freeze this candidate prospectively and accumulate outcomes. If earlier audited VOO/GLD proxy history is introduced, define the source and splice policy before inspecting results, then repeat nested selection and one untouched outer score.
### 2026-07-10 — CoinGecko scheduled-ingestion rate-limit mitigation

- **Status:** validated and deployed
- **Hypothesis:** Reusing CoinGecko's hourly market-chart payload for both price aggregation and the first UTC volume snapshot halves scheduled BTC requests while preserving the existing source and daily-candle convention, reducing shared-edge 429 failures without changing forecast inputs.
- **Data/source changes:** No source or feature change. The seven-day CoinGecko request count changes from two to one; 429 retries now honor `Retry-After` with a bounded 30-second delay and jitter.
- **Validation setup:** Normalization fixture for first UTC volume selection, focused Worker tests, full test/type/build gates, BTC and market backtests, preview/production scheduled invocation, and D1/API latest-date inspection.
- **Report artifacts:** Deployment/run evidence in the implementation handoff and `refresh_runs`; existing daily quote PRD and production D1 records.
- **Result/verdict:** Worker tests, full unit/build/lint gates, BTC and market backtests, and the 8-case browser/accessibility suite passed. The production Worker was redeployed with D1 bound and Cloudflare confirmed the `15 23 * * *` trigger. Live API smoke checks passed for BTC, S&P 500, and gold with forecast agreement; BTC retained the validated 2026-07-09 row when the upstream shared edge returned 429. This is validated operational plumbing only and does not alter forecast signals.
- **Rerun criteria:** CoinGecko response schema, volume semantics, retry policy, or source changes.
- **Next better experiment:** Add an authenticated CoinGecko plan or separately validated same-instrument fallback only if bounded retries remain unreliable over seven scheduled production runs.

---

## 2026-07-13 — BTC moving-average crossover reversal event study

Status: `completed — rejected; no statistically confirmed reversal signal`

### Hypothesis

A close-confirmed moving-average crossover can identify a BTC trend reversal early enough that the signed forward return after the signal exceeds the unconditional same-period return by a statistically and practically meaningful amount. The primary confirmatory endpoint is 30-calendar-day signed excess log return. Up-crosses are bullish (`+1`) and down-crosses are bearish (`-1`).

The frozen primary family contains exactly seven signals: close/SMA50, close/EMA50, close/SMA200, close/EMA200, SMA50/SMA200, EMA50/EMA200, and the canonical close/SMA200 rule with a fixed 1% hysteresis band. The 1% rule was added from the Brock-Lakonishok-LeBaron literature review before any experiment outcome was calculated and is included in the multiplicity correction. No other threshold, confirmation-day, volatility, volume, RSI, or cycle filter will be selected from the final holdout.

### Data/source changes

No data-source or product change. Use the checked-in daily UTC BTC OHLCV history in `src/data/btc-history.json`, pinned by file hash. The pre-run data audit found 32 malformed legacy OHLC candles between 2013-10-22 and 2017-04-06, so rows before `2018-01-01` are indicator warm-up only and are excluded from scored returns. SMA and EMA values are calculated only from closes through signal date `t`. A signal is available only after the UTC close at `t`; the hypothetical trade enters at `open[t+1]` and exits at `open[t+h+1]`, with a frozen 20-basis-point round-trip cost deducted from signed log return. This checked-in aggregate history is latest-revised rather than vintage data, and recent opens are reconstructed from CoinGecko hourly observations rather than executable exchange quotes.

Online research is context for the frozen hypotheses only. It does not authorize new runtime data, a parameter search, or a product/UI/forecast change.

### Validation setup

- Development audit: mature signals from `2018-01-01` through `2021-12-31`.
- Frozen historical holdout: signals on or after `2022-01-01`, through the latest signal with a mature forward target. It is not used to add, drop, or tune candidates. Because 2022+ BTC prices have been inspected elsewhere in this repository, this is not a pristine prospective holdout and cannot by itself authorize production promotion.
- Primary horizon: `30d`. Secondary robustness horizons: `7/14/60/90d`; secondary results cannot rescue a failed primary endpoint.
- Event definition: the signed difference changes strictly from `<= 0` to `> 0` (up) or from `>= 0` to `< 0` (down). Equality does not create repeated events. EMA initialization is the first observed close and uses `alpha=2/(window+1)` recursively.
- Primary statistic for signal `j`: `D_j = mean[s_i * (log(O[t+h+1]/O[t+1]) - mu_h) - cost]`, where `s_i` is `+1/-1`, `mu_h` is the unconditional mean entry-to-exit log return over every eligible date in the same evaluation period and horizon, and cost is `0.002`. This asks whether event timing adds information beyond BTC's period drift, rather than rewarding every bullish rule for BTC's positive historical drift.
- Secondary metrics: raw signed net return, median signed excess return, win rate, up/down event counts and effects, maximum drawdown of non-overlapping event trades, and development/holdout sign consistency.
- Dependence control: seeded circular moving-block bootstrap of the daily event/return series with block length at least the horizon for a 95% effect interval. A seeded circular-shift randomization test breaks signal/forward-return alignment while preserving crossover clustering and return dependence.
- Multiple testing: Holm adjustment across the seven primary 30-day candidate p-values. Secondary horizons and direction splits are explicitly descriptive.
- Promotion gate per candidate: at least 30 final-holdout events and at least 20 distinct 14-day crossing episodes, positive development and holdout mean effects, at least 1% mean signed excess log return after costs on the final holdout, positive 95% bootstrap lower bound, Holm-adjusted one-sided `p < 0.05`, and no sign reversal across `2022-2024` versus `2025+` when each subperiod has at least five events. Episode count is a power/dependence guardrail; raw alternating whipsaws are not treated as independent evidence.
- Failure criteria: any future-price use in feature construction, signal execution before the confirming close, failure of any promotion gate, or a result dependent on changing a frozen window/horizon/cost/test after holdout inspection.

### Report artifacts

- Script: `scripts/backtest-trend-reversal.ts`.
- Experiment reports: `docs/reports/results/trend-reversal-2026-07-13T17-57-48-796Z.md` and `.json`.
- Forecast regression reports: `docs/reports/results/backtest-2026-07-13T17-54-26-044Z.md` and `.json`.

### Result / verdict

Verdict: `rejected-no-confirmed-signal`. No candidate cleared the pre-registered 30-day historical-holdout gate, so no product, UI, regime, or forecast behavior change is authorized.

- Close/SMA50: 98 raw events and 33 distinct 14-day episodes; `+0.80%` mean net signed excess return; 95% moving-block interval `[-0.79%, +2.55%]`; Holm-adjusted circular-shift `p=0.51543`.
- Close/EMA50: 106 events and 36 episodes; `+0.21%`; interval `[-1.21%, +1.75%]`; adjusted `p=0.99012`.
- Close/SMA200: 32 events but only 11 episodes; `+2.13%`; interval `[-0.34%, +6.66%]`; exact all-shift raw `p=0.03889`, but Holm-adjusted `p=0.27222`. Its 2018-2021 development effect was `-2.37%`, so the apparent holdout effect reverses sign.
- Close/EMA200: 54 events and 12 episodes; `-0.31%`; interval `[-2.09%, +1.68%]`; adjusted `p=1.00000`.
- SMA50/SMA200 golden/death cross: only 9 events; `+1.13%`; interval `[-8.87%, +10.88%]`; adjusted `p=1.00000`.
- EMA50/EMA200: only 5 events and 4 episodes; `+2.21%`; interval `[-8.52%, +13.83%]`; adjusted `p=1.00000`.
- Close/SMA200 with the canonical 1% band: 20 events and 10 episodes; `+3.41%`; interval `[-0.84%, +9.86%]`; exact all-shift raw `p=0.03951`, but Holm-adjusted `p=0.27222`. Its development effect was `-2.83%`.

The unadjusted SMA200 hints are not statistically confirmed: both dependence-aware confidence intervals include zero, both fail family-wise multiplicity correction, both have too few independent episodes, and both reverse sign versus the frozen development period. Up/down diagnostics also show horizon and regime instability. Golden/death crosses are too sparse to evaluate credibly on this history.

Independent validation reproduced the seven primary event counts, up/down counts, point effects, maturity cutoff, episode counts, and Holm calculations. It also replaced an initially undocumented restricted-shift Monte Carlo diagnostic with exact enumeration of every nonzero circular shift; the corrected p-values are less favorable and leave the rejection unchanged. The final artifact records script and signal-library SHA-256 hashes because the experiment code is not represented by the reported HEAD commit. Moving-block and circular-shift inference remain approximate under BTC regime nonstationarity, which is an additional reason not to promote a historical hint.

Validation commands:

- `npm run backtest:trend-reversal` — deterministic verdict `rejected-no-confirmed-signal`.
- `npm test -- --run` — 27 files and 104 tests passed; the final focused suite contains seven point-in-time crossover, execution-alignment, maturity, episode, and Holm tests.
- `npm run lint` — passed.
- `npm run backtest` — forecast quality gate and robustness audit passed; this experiment did not change runtime forecasts.

### Rerun criteria

Rerun this frozen family only when genuinely new daily observations mature, the checked-in BTC source/UTC candle convention changes, or an independently motivated signal family is separately pre-registered. Do not search neighboring windows or confirmation thresholds on the 2022+ holdout.

### Next better experiment

If no candidate clears the gate, retain crossovers as chart context only and prospectively accumulate events. If exactly one candidate clears every gate, independently reproduce its math and run `npm run backtest` before considering any separately scoped app integration.

---

## 2026-07-13 — BTC canonical technical-indicator reversal study

Status: `completed — rejected; no statistically confirmed indicator reversal signal`

### Hypothesis

Canonical close-confirmed oscillator or band re-entry events may identify BTC trend reversals more reliably than the rejected moving-average crossover family. The primary confirmatory endpoint is 30-calendar-day signed excess log return after 20 basis points of round-trip cost.

The frozen family contains exactly four bidirectional rules. Each rule is one primary hypothesis; bullish and bearish splits are diagnostics only:

1. `rsi14-extreme-exit`: Wilder RSI(14) crosses above 30 after being at or below 30 (bullish), or below 70 after being at or above 70 (bearish). Average gain/loss is seeded with the simple mean of changes 1-14 and recursively smoothed as `(13 * previous + current) / 14`.
2. `bollinger20x2-reentry`: after a close outside the trailing SMA20 plus/minus two population standard deviations, the close re-enters the band. Lower re-entry is bullish; upper re-entry is bearish.
3. `stochastic14x3-extreme-cross`: `%K = 100 * (close - LL14) / (HH14 - LL14)` and `%D = SMA3(%K)`. A bullish K-over-D cross requires current K and D at or below 20; a bearish cross requires both at or above 80. A zero high-low range yields no signal.
4. `macd12x26x9-opposite-zero-cross`: MACD is EMA12 minus EMA26 and its signal is EMA9(MACD), all recursively seeded by the first available value. A positive histogram cross is bullish only while current MACD is at or below zero; a negative histogram cross is bearish only while current MACD is at or above zero.

No neighboring windows, thresholds, divergence definitions, candlestick patterns, confirmations, volume filters, or candidate combinations will be selected after outcomes are inspected.

### Data/source changes

No data-source or runtime change. Use the pinned checked-in daily UTC BTC OHLCV history in `src/data/btc-history.json`. Score only signals from `2018-01-01` onward; earlier data are indicator warm-up because the legacy history contains 32 malformed OHLC rows ending in 2017. The 2018+ slice has 3,112 consecutive daily rows, no missing/duplicate dates, zero nonpositive values, and no OHLC invariant violations.

All features use data through completed UTC candle `t`; a signal is available only after that close. Hypothetical execution is `open[t+1]` to `open[t+h+1]`. The cache is latest-revised rather than vintage data, and recent CoinGecko-derived opens are aggregate sampled observations rather than executable exchange quotes. Volume rules are excluded because volume provenance is materially less stable across the history.

### Validation setup

- Development audit: mature signals from `2018-01-01` through `2021-12-31`. It is used only for implementation/sign robustness, not parameter selection.
- Frozen historical holdout: mature signals from `2022-01-01` onward. The candidate family was frozen before inspecting its forward-return outcomes. Because this price period has been inspected by earlier repository studies, it is not a pristine prospective holdout and cannot alone authorize promotion.
- Primary horizon: `30d`. Secondary descriptive horizons: `7/14/60/90d`; they cannot rescue a failed primary endpoint.
- Primary statistic: `D_j = mean_i[s_i * (log(O[t+31]/O[t+1]) - mu_30) - 0.002]`, where `s_i` is `+1/-1` and `mu_30` is the mean eligible-date 30-day log return in the same evaluation period.
- Secondary metrics: raw signed net return, median excess return, win rate, bullish/bearish counts and effects, 30-day transitive episode count, greedy non-overlapping trade drawdown, subperiod effects, and largest-event contribution.
- Dependence: 5,000 circular moving-block bootstrap samples at frozen block lengths `30/60/90d`. All three 95% lower bounds must be positive for promotion.
- Timing null: 50,000 fixed-seed randomizations that circularly shift the complete four-signal vector jointly within each calendar year, preserving within-year signal clustering/correlation while breaking signal/forward-return alignment. This reduces but does not remove regime-nonstationarity concerns.
- Multiple testing: report Holm correction within the four new rules and a search-history Holm correction across all 11 primary rules: the seven previously tested MA rules plus these four. The 11-rule correction is the promotion p-value.
- Promotion gate: at least 30 holdout events, at least 20 distinct transitive 30-day episodes, at least 10 bullish and 10 bearish events, positive development and holdout effects, at least 1% holdout mean net excess, positive 30/60/90 block-bootstrap lower bounds, search-history Holm `p < 0.05`, no materially negative direction, positive `2022-2024` and `2025+` effects when each has at least five events, and no single event above 20% of absolute effect contribution.
- Failure criteria: future data in an indicator, same-close execution, a target crossing a split boundary, failure of any gate, or changing a frozen definition after seeing the holdout.

### Report artifacts

- Script: `scripts/backtest-indicator-reversal.ts`.
- Pure indicator library/tests: `src/lib/technicalReversal.ts` and `src/lib/__tests__/technicalReversal.test.ts`.
- Results: `docs/reports/results/indicator-reversal-2026-07-13T18-13-05-322Z.md` and `.json`.
- Forecast regression reports: `docs/reports/results/backtest-2026-07-13T18-10-43-134Z.md` and `.json`.

### Result / verdict

Verdict: `rejected-no-confirmed-signal`. No rule cleared the pre-registered 30-day historical-holdout gate, so no product, UI, regime, or forecast behavior change is authorized.

- Wilder RSI(14) extreme exit: 47 mature events and 21 distinct 30-day episodes; `-1.34%` mean signed net excess; 30/60/90-day block intervals `[-5.57%, +2.51%]`, `[-5.62%, +2.71%]`, and `[-5.69%, +2.79%]`; raw year-stratified shift `p=0.27421`; four-rule Holm `p=0.82264`; 11-rule search-history Holm `p=1.0`; development effect `-6.14%`.
- Bollinger(20,2) re-entry: 98 events but only 15 episodes; `-0.69%`; block intervals `[-4.06%, +2.67%]`, `[-3.83%, +2.74%]`, and `[-3.54%, +2.42%]`; raw `p=0.45365`; four-rule Holm `p=0.89234`; search-history Holm `p=1.0`; development effect `-5.07%`.
- Stochastic(14,3) extreme K/D cross: 131 events but only 15 episodes; `-1.47%`; block intervals `[-4.93%, +2.11%]`, `[-4.78%, +2.14%]`, and `[-4.36%, +1.87%]`; raw `p=0.44617`; four-rule Holm `p=0.89234`; search-history Holm `p=1.0`; development effect `-3.24%`.
- MACD(12,26,9) opposite-zero signal cross: 76 events but only 15 episodes; `+0.36%`; block intervals `[-3.62%, +4.17%]`, `[-3.76%, +4.50%]`, and `[-3.84%, +4.32%]`; raw `p=0.18178`; four-rule Holm `p=0.72711`; search-history Holm `p=1.0`; development effect `+1.39%`.

The three canonical contrarian/re-entry indicators had negative primary point estimates. MACD was the least-bad candidate, but its effect was below the 1% practical threshold, every confidence interval crossed zero, its bearish direction was `-0.96%`, and its effect changed from `-0.72%` in `2022-2024` to `+2.11%` in `2025+`. Secondary horizons do not supply a stable alternative: MACD was `+0.38%` at 14 days but negative at 7/60/90 days; RSI was `+0.85%` at 60 days but negative at 7/14/30/90 days and strongly negative in development. These are diagnostics, not candidate rescues.

The outcome is consistent with the online evidence: large BTC technical-rule studies find time-varying, selection-sensitive results, and pure out-of-sample Bitcoin profitability often disappears. OBV was not tested because the repository audit found materially less stable aggregate-volume provenance; CCI, ATR, divergence, and parameter variants were excluded before outcomes to avoid an open-ended search.

Independent validation used a separate Python implementation and exactly reproduced all development/holdout eligible-day counts, event/up/down counts, 30-day episode counts, unconditional drift, and primary effects. It confirmed the Wilder RSI, Bollinger, stochastic, and MACD formulas; prefix safety; next-open alignment; target maturity; block bootstrap; joint within-year shifts; 11-rule Holm correction; and gates. Verdict: keep the rejection. The final JSON pins the prior MA artifact SHA-256 used in the global correction and the implementation file hashes. It also discloses that the reported HEAD does not contain uncommitted experiment files and that the stratified-shift p-value is an approximate alignment rank test, not a directly centered test of `D=0`.

Validation commands:

- `npm run backtest:indicator-reversal` — deterministic verdict `rejected-no-confirmed-signal`.
- `npm test -- --run src/lib/__tests__/technicalReversal.test.ts src/lib/__tests__/trendReversal.test.ts` — 13 focused tests passed, including direct threshold/equality event fixtures.
- `npm test -- --run` — 28 files and 110 tests passed after the final amendment.
- `npm run lint` — passed after the final amendment.
- `npm run backtest` — forecast quality gate and robustness audit passed; this experiment did not change runtime forecasts.

### Rerun criteria

Rerun the frozen family only after genuinely new observations mature, an independent exchange-grade candle dataset is pre-registered, or source/candle semantics change. Do not search adjacent RSI, band, stochastic, or MACD parameters on the 2022+ outcomes.

### Next better experiment

If every rule fails, keep these indicators as chart context only and prospectively accumulate observations. If one rule clears all gates, independently reproduce it on exchange candles and run the forecast regression gates before considering a separately scoped integration.
