# Production price gap and forecast audit — 2026-09-09

Verdict: confirmed production data continuity bug; no clean production/model sign-off. Investigation only; no runtime, source dataset, or production changes were made.

## Reproduction and cause

At approximately 23:16–23:18 UTC, the production bundle `assets/index-yUsd8XzS.js` at https://bitcoin-forecast-visualizer.pages.dev contained BTC history ending 2026-08-17 at $64,239.06. Its hydration code matches the checked-out client. `GET /api/market-data?asset=btc&since=2026-08-01` returned only September 2–9. September 2 closes at $77,300.4766. The merge therefore places a 20.33% move over 16 calendar days into adjacent rows, omitting August 18–September 1 (15 candles). This explains the discontinuity before the forecast marker in the supplied screenshot.

- `functions/_shared/marketDataRepository.ts`: `ORDER BY date DESC LIMIT 8` discards requested history whenever the bundle lags by more than eight candles. The same read path feeds the forecast API.
- `src/lib/marketDataClient.ts`: accepts newer rows without continuity validation. It additionally discards repairs before the last bundle date, despite requesting a seven-day repair window; the server merges those repairs, permitting browser/server input divergence.
- `workers/market-quote-refresh/src/sources.ts`: fetches a fixed seven-day window. Removing the API cap alone cannot guarantee recovery if the database itself lacks older rows. Database contents beyond the exposed API window were not inspected.
- Freshness and production smoke checks inspect newest dates and agreement, not completeness. All three assets passed the production smoke check while BTC had this gap. VOO and GLD also join August 14 directly to August 28, omitting nine expected trading sessions.

Yahoo BTC-USD history independently fetched from its chart endpoint contains every missing BTC date. It shows a multi-day rally, including August 19–21, rather than the displayed single adjacency. Source comparison is against the same vendor used by the live fallback, not an independent exchange verification. The latest September 9 candle is intraday and can still change.

## Measured forecast impact

Diagnostic intervention: retain the exact bundle and captured production rows, insert only the 15 missing Yahoo daily candles, and recompute using unchanged production model functions. This isolates continuity; it does not promote a new data source or model.

| Quantity | Production inputs | Missing candles inserted |
| --- | ---: | ---: |
| Blended daily volatility | 2.60119% | 2.12126% |
| 30-day probability up | 28.1829% | 23.9456% |
| 30-day median | $72,421.61 | $72,421.61 |
| 30-day q05 | $58,428.44 | $60,789.44 |
| 30-day q95 | $89,766.04 | $86,279.61 |

The missing data inflate estimated volatility by approximately 22.6% relative to this repaired diagnostic. Adjacent-row returns are interpreted as daily returns in `forecastInterval.ts`; moving averages and bootstrap scenarios also consume the incomplete row sequence. The BTC median depends on current price/date, so it is unchanged in this probe. At tested horizons 14/30/90/180/365, the forecast anchor and first forecast open both equal the captured latest close, $78,090.9766. There is no starting-price anchor discontinuity in that computation.

## Model validation and limits

`npm run backtest` exited 0. Accuracy gate and block-bootstrap robustness audit both PASS on bundled BTC history through August 17, with holdout beginning 2022. Approximate median multiplicative errors: 14d 5.3%, 30d 8.6%, 60d 14.6%, 90d 16.3%. Corresponding 95% interval coverage: 93.6%, 94.8%, 98.0%, 95.9%. At 365d, coverage is 100%, indicating conservative bands rather than precise nominal calibration. The main quality gate compares median error at 14/30/60/90d; it is not a comprehensive calibration or live-data integrity gate.

The selected BTC strategy is `no-future-pivots`, so its median matches the power-law baseline evaluated by the backtest. `src/components/chart/dataTransforms.ts` uses stochastic trace zero for the jagged future candles and the deterministic forecast for the median line. Passing endpoint backtests does not validate the timing of individual simulated swings. This audit did not run new model selection, a full point-in-time refit benchmark, fresh VOO/GLD backtests, or browser screenshot tests. The prospective candidate ledger currently contains zero rows; it supplies no additional prospective evidence.

`npm run lint` exited 0. `npm test` exited 1: 186 passed, two failed across 35 files. Both failures were traced to mutable data in supposedly fixed fixtures:

1. `forecastInterval.test.ts` slices the latest 900 BTC rows but asserts constants from July 15. Current code with the original dataset from commit `d1353bf` reproduces all original expected quantiles exactly.
2. `forecastUiInvariance.test.ts` reads refreshed VOO history; its January 3, 2017 close is now 177.1337 versus expected 177.1338. Current code with the original `d1353bf` VOO fixture reproduces the expected close, median, q10, and q90 exactly.

These are test fixture defects, not evidence of a new forecast math regression. They remain unfixed in this diagnostic task.

## Proposed repair and acceptance checks

1. Return the complete requested candle interval using bounded pagination, and consume all pages before merging. Backfill any missing database history from the last contiguous date; do not synthesize/interpolate prices.
2. Apply the same authoritative repair window in browser and server. Detect calendar-aware gaps: daily BTC and expected US sessions for VOO/GLD. Incomplete data must not receive an unqualified current/ready forecast status.
3. Add a production regression with a bundle more than eight observations behind, an outage beyond seven days, and repaired overlapping rows. Check browser/server input and forecast parity, not just latest dates.
4. Freeze actual input fixtures for the two failing tests, then rerun tests, type checking, backtest, and continuity-aware production checks after an authorized repair.

## Evidence

- `production-gap-audit-2026-09-09.json`: captured production responses for all assets, raw Yahoo comparison, missing candles, and per-horizon impact.
- `production-gap-audit-2026-09-09-tests.txt` and `production-gap-audit-2026-09-09-lint.txt`: original command output.
- `backtest-2026-09-09T23-16-33-267Z.json` and `.md`: full current BTC backtest; source commit `23a3c66ab3bea51be204aea5769a6072d0f21a74`, clean source tree at run start.
