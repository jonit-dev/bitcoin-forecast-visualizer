# Critical-area bug scan — 2026-10-26

✅ Read findings **1 and 2 first**: the daily publish workflow can stop before deployment, and a partial BTC refresh can delete valid cached candles.

**What this repo does:** It displays BTC, VOO, and GLD prices and forecasts. Checked-in history and a scheduled Cloudflare Worker supply daily candles; the browser and forecast APIs consume that history.

**Scope:** Data ingestion and repair, D1 reads, browser hydration, forecast summaries and distributions, market calendars, and the daily update workflow. Assumed load: an unattended daily refresh plus ordinary dashboard and API requests, including the supported 10-year horizon.

**Revision:** `7767d7b051992c404d36e84778b6ef56ae6415b6` on `master`. File/line references below use that revision. Concurrent, uncommitted forecast-path research edits appeared during the scan; their experimental behavior is excluded. Reproductions used the default production policy. This audit created this report only and left those edits intact.

**Result:** 13 findings: **2 P1**, **10 P2**, and **1 P3**. P1 means fix next; P2 means a confirmed correctness or performance defect; P3 means a lower-impact output inconsistency. Findings are report-only. No application fixes, new model candidates, data refreshes, commits, pushes, or deployments were performed.

## P1 — Repair first

### 1. Daily data publishing stops on a nonexistent lockfile

**Location:** `.github/workflows/forecast-data-update.yml:54`.

**Trigger and cause:** Whenever the refresh changes tracked data, the workflow runs `git add src/data package.json package-lock.json yarn.lock`. This repository tracks `yarn.lock` and has no `package-lock.json`. The missing path makes the entire command fail.

**Verified:** The non-mutating reproduction `git add --dry-run src/data package.json package-lock.json yarn.lock` exited **128** with `fatal: pathspec 'package-lock.json' did not match any files`.

**Impact:** The commit and push do not run. The later deployment step is skipped after the failed step. Bundled prices and supporting forecast data cannot receive that scheduled update through this workflow.

**Smallest fix:** Remove `package-lock.json` from the explicit staging paths. Keep the Yarn lockfile.

**Regression check:** Run the staging dry run against a checkout with refreshed data and confirm it exits zero without staging anything.

### 2. A successful but incomplete BTC repair deletes valid history

**Location:** `scripts/update-btc-data.mjs:161–169`.

**Trigger and cause:** The source returns a nonempty subset of the requested repair interval. The updater preserves only rows before `repairStart`, then replaces the entire remaining history with that subset. It checks for an empty result, but does not require complete coverage or retain existing rows omitted by the response.

**Verified:** Executed the real `updateBTCData` implementation in a JavaScript VM with an in-memory filesystem, a fixed clock, and a stubbed successful fetch. Existing dates were September 5, 6, 7, and 8, 2026. Returning only the September 8 candle caused the function to write **one row and delete the other three**. No real cache was written.

**Impact:** A partial upstream response becomes permanent local data loss. Adjacent retained observations can then represent several days while volatility and other calculations treat them as daily returns. This path runs during development preflight, scheduled updates, and deployment preparation.

**Smallest fix:** Merge validated repairs into existing rows by date. Check continuity before replacing the cache, and preserve the previous file when the result is incomplete. Use the existing atomic temporary-file/rename pattern from the market updater when persisting it.

**Regression check:** Give the updater a sparse successful response and assert that all existing valid dates survive. A genuinely missing date must fail the completeness check before a write.

## P2 — Candle and forecast correctness

### 3. Unfinished daily candles enter the completed-history paths

**Locations:** `scripts/update-market-data.mjs:63–84`; `workers/market-quote-refresh/src/normalize.ts:96–104`; `.github/workflows/forecast-data-update.yml:6`.

**Trigger and cause:** There are two affected paths. The checked-in VOO/GLD updater accepts every returned daily candle without checking whether its session has closed. Separately, the Worker's Yahoo normalizer uses the ETF cutoff of 21:00 UTC for BTC fallback data, even though the BTC UTC day remains open until midnight.

**Verified:** With the real market-updater parser and a fixed clock of `2026-07-08T14:15:00Z`, a mocked Yahoo candle for July 8 was accepted. That clock matches the scheduled workflow time. With `normalizeYahoo` at `2026-09-09T23:15:00Z`, a same-day BTC candle was accepted; `normalizeCoinGecko` correctly rejected the same unfinished date at that clock. Both checks used synthetic responses and wrote no real files.

**Impact:** Forecasts and historical comparisons can use provisional closes and volumes. BTC anchor dates also change depending on whether CoinGecko succeeds or Yahoo fallback is used. Once a partial candle is bundled, the runtime merge can retain it until a final authoritative candle arrives.

**Smallest fix:** Apply an asset-aware completed-candle rule in both ingestion paths: previous UTC dates for BTC; completed US sessions for VOO/GLD.

**Regression check:** Exercise both sources before and after the relevant close, including a BTC Yahoo fallback at the production cron time.

### 4. An accepted S&P 500 horizon can return a different model from its chart

**Location:** `src/lib/marketForecast.ts:700–721`, compared with `src/lib/marketForecast.ts:521–529`; accepted input range in `functions/api/forecast.ts:22–26`.

**Trigger and cause:** The API accepts every integer horizon from 1 to 3,650. The S&P 500 chart uses the interpolated causal session-residual (CSR) forecast at every day, but the summary uses CSR only at the nine named anchor horizons. At other accepted horizons, it silently returns the old constant-drift forecast.

**Verified:** Called `buildMarketForecast('sp500', loadMarketData('sp500'), 60, 1.6448536269514722)`. For the same target date, `2026-10-13`, the final chart median was **$720.881789**, while `probabilityForecast.median` was **$729.274084**. The corresponding lower 90% endpoints were **$660.648236** and **$656.220882**.

**Impact:** Valid API requests such as `horizon=60` use a different median, interval, probability, and calibration label from the forecast path built for that same request.

**Smallest fix:** When a CSR projection exists, build the summary from the same interpolated median and log scale that the chart uses for the requested day.

**Regression check:** Compare summary and path endpoints at off-anchor horizons such as 60 and 120 days, as well as existing anchor horizons.

### 5. Gold heatmaps subtract volatility from an already defined log-return forecast

**Location:** `src/lib/marketForecast.ts:647`, compared with `src/lib/marketForecast.ts:720–725`.

**Trigger and cause:** The gold summary defines its median as `spot * exp(drift * horizon)`. The heatmap instead simulates log increments using `drift - 0.5 * dailyVol²`. This adds a second drift correction and shifts the distribution below the declared median. The same branch is used when S&P 500 falls back from CSR.

**Verified:** On bundled GLD history at 3,650 days, the summary median was **$2,959.22**. The heatmap's mathematical median under its actual increments was **$1,629.25**. Reading the generated terminal heatmap cells and accumulating their density weights placed the sampled median in **$1,474.52–$1,527.65**. The daily volatility was `0.018083591662643814`.

**Impact:** The probability summary and heatmap describe materially different distributions. The discrepancy grows with horizon and volatility.

**Smallest fix:** Center the heatmap's log increments on the same median log-return path used by the summary.

**Regression check:** Compare simulated terminal medians with analytical medians at short and long horizons using a deterministic seed and a declared sampling tolerance.

### 6. The S&P 500 heatmap omits the retained 180-day interval width

**Locations:** `src/lib/marketForecast.ts:643–645`; `src/lib/csrV1.ts:293–299`.

**Trigger and cause:** CSR deliberately retains 180 calendar-day variance at the 180-day anchor. The heatmap adds only `dailyVol` noise on each actual trading session, so it does not implement that retained variance or the surrounding interpolated variance curve.

**Verified:** For the bundled VOO origin, the 180-day projection contained **123 sessions**. Its interval variance was **0.01235381953514884**, but the heatmap's implemented variance was **0.008441776682351708**. That is **68.33%** of the intended variance, or about **17.3% less standard deviation**. This follows directly from the executed projection and the Gaussian increment formula, without relying on visual comparison or sampling error.

**Impact:** The default 6-month S&P 500 heatmap understates the spread specified by its own interval and summary.

**Smallest fix:** Derive each shock's variance from the change in the shared CSR cumulative variance, using the existing projection helpers.

**Regression check:** Assert that the sum of simulated daily innovation variances matches the projection's terminal log variance, particularly at 180 days.

### 7. BTC heatmaps omit the long-horizon uncertainty policy

**Locations:** `src/lib/data.ts:433–473` (`simulateHeatmapPrices`); `src/lib/forecastInterval.ts:52–54,173–190`.

**Trigger and cause:** The reported interval applies calibrated effective scales and explicitly increases long-horizon uncertainty beyond 365 days. The heatmap uses an unscaled mean-reverting residual process. Its process variance approaches a ceiling and does not apply that extrapolation policy.

**Verified:** For bundled BTC history and a 3,650-day horizon, the summary's 5th/95th percentiles were **$248,558.12 / $1,340,451.68**. The actual default heatmap simulation's terminal 5th/95th percentiles were **$413,299.84 / $791,089.67** across 500 deterministically seeded paths.

**Impact:** The heatmap represents a much narrower long-range distribution than the forecast's stated uncertainty. Existing Monte Carlo checks compare the median through 365 days; they do not catch this width mismatch.

**Smallest fix:** Apply the same horizon-dependent uncertainty policy to the heatmap's marginal distributions while preserving the declared median. Validate any resulting distribution change through the required forecast gates before promotion.

**Regression check:** Compare terminal quantiles with the shared interval at 365, 1,825, and 3,650 days, with fixed seeds and explicit sampling tolerances.

## P2 — Cache, fallback, and calendar correctness

### 8. ETags hide corrected candle values

**Location:** `functions/api/market-data.ts:18–19`.

**Trigger and cause:** The ETag contains only the asset, query start, latest contiguous date, and latest observed date. Repairing OHLCV values on an existing date changes the response body without changing any of those fields.

**Verified:** Used the real request handler with an in-memory D1 stub. The first response contained an August 17 BTC close of **$64,239.06**. Changed that same candle to **$64,339.06** and repeated the request with the original `If-None-Match`. The handler returned **304**. An unconditional request returned the corrected value, under the same ETag.

**Impact:** Browser or downstream HTTP caches can retain wrong prices after a repair. Refresh status and continuity details can also change without a new latest date.

**Smallest fix:** Base the validator on the actual representation, or remove conditional 304 handling until a reliable content/revision validator exists. A timestamp from only the newest candle does not cover repairs to earlier rows.

**Regression check:** Change an existing candle without changing dates and assert that the previous validator yields a 200 response with the correction.

### 9. Offline browser fallback returns a known discontinuous series to the model

**Location:** `src/lib/marketDataClient.ts:40–48`, compared with the guard in `functions/_shared/marketDataRepository.ts:129–132`.

**Trigger and cause:** If hydration fails and bundled history has a hole, the catch branch assesses continuity but returns the original unguarded bundle. The successful browser path and the server both truncate at the last contiguous candle.

**Verified:** Passed a bundle containing July 6 and July 8, 2026, to `hydrateMarketData` with a fetcher that throws. It correctly reported missing July 7, but still returned **both candles** and anchored on July 8. The shared guard returned **only July 6** for the same data and repair window.

**Impact:** The fallback bypasses the safeguard intended to keep multi-day returns out of daily-return calculations. Browser and server forecasts can diverge under exactly the data-loss condition in finding 2.

**Smallest fix:** Apply the shared guard in the catch branch and derive the returned market data and anchor from its guarded rows.

**Regression check:** Combine a gapped bundle with a rejected/failed fetch and assert the same safe anchor as the server.

### 10. Intraday Date inputs count a future session as elapsed

**Location:** `shared/us-market-calendar.mjs:71–77`; production caller in `functions/_shared/marketDataRepository.ts:45–47`.

**Trigger and cause:** The session counter starts at midnight but compares against an unnormalized `Date` with an intraday time. After reaching today's midnight, its loop runs again, advances to tomorrow, and counts tomorrow if it is a session.

**Verified:** `countUsMarketSessionsAfter('2026-08-17', '2026-08-20')` returned **3**. Passing `new Date('2026-08-20T23:15:00Z')` for the same end day returned **4**.

**Impact:** The API can label a three-session-old ETF quote delayed against its threshold of three, while the watchdog's date-string calculation treats the same quote as within the limit.

**Smallest fix:** Normalize the end value to its UTC date before walking the calendar.

**Regression check:** Require identical counts for date strings, midnight Dates, and intraday Dates representing the same UTC day, including Friday/weekend boundaries.

### 11. CSR counts exceptional exchange closures as trading sessions

**Location:** `src/lib/csrV1.ts:118–127`, compared with `shared/us-market-calendar.mjs:64–68`.

**Trigger and cause:** CSR's separate session ladder checks weekdays and recurring holidays, but bypasses the shared calendar's exceptional closure table.

**Verified:** From origin `2025-01-06` over seven calendar days, `csrSessionCounts(origin)[7]` returned **5**. Counting those days with the shared `isUsMarketSessionDay` returned **4**, because the shared calendar excludes January 9, 2025.

**Impact:** Historical CSR forecasts spanning a recorded exceptional closure use the wrong session features, uncertainty, and day progression. The data-continuity guard and forecast engine disagree on the exchange calendar.

**Smallest fix:** Reuse the shared session predicate, or expose one shared cached calendar implementation that includes exceptional closures.

**Regression check:** Compare CSR session counts with the shared predicate over intervals containing a day of mourning and the Sandy closures, alongside ordinary holidays.

## P2 — API performance

### 12. Summary API requests generate and discard full chart simulations

**Locations:** `functions/api/forecast.ts:69`; `src/server/ForecastController.ts:83`; `src/lib/marketForecast.ts:750–831`.

**Trigger and cause:** Every summary request calls `buildMarketForecast`, which builds all historical chart rows, stochastic traces, heatmap simulations, and market channels. The response discards `displayData` and `heatmapData`. Those synchronous computations are repeated per request.

**Verified:** A local default 180-day BTC build took **259 ms**, generated **6,056 chart rows** and **5,848 heatmap cells**, and returned the same median as `computeProbabilityForecast` alone, which took **1.58 ms**. A 60-day S&P 500 full build took **3,448 ms**. These are single local measurements on a shared machine, not production capacity benchmarks; BTC's API also returns drawdown statistics, whose required cost must be retained.

**Impact:** The compact API pays for expensive chart-only work on every request. In the local Express server, that synchronous work also blocks unrelated requests on the same process.

**Smallest fix:** Reuse the existing endpoint/model calculations in a summary path that does not materialize chart rows or heatmaps. Keep the returned drawdown fields and model-selection behavior intact.

**Regression check:** Compare complete summary responses with the existing implementation, including gold 365-day routing and CSR horizons. Verify that summary requests do not invoke chart/heatmap generation.

## P3 — Derived quote output

### 13. Live BTC price repairs leave market capitalization at the bundled price

**Locations:** `src/lib/api.ts:45–48,115–117`; `functions/_shared/marketDataRepository.ts:136`; displayed by `src/App.tsx:399`.

**Trigger and cause:** Both merge paths update price, percentage change, and volume but spread the old `marketCap` unchanged. BTC's initial market cap is derived from its initial close and the existing supply estimate.

**Verified:** Passed a repaired BTC close of **$128,478.12**, twice the bundled **$64,239.06**, through `withOHLCV`. The current price doubled, while market cap remained **$1,271,933,388,000**. Reusing the same existing supply estimate with the repaired price gives **$2,543,866,776,000**.

**Impact:** Market data returned to the UI contains a live price and a capitalization calculated from an older price. This is a derived-data check; the browser rendering was not visually inspected.

**Smallest fix:** Recompute BTC capitalization from the updated close and the existing supply estimate in the shared quote-update path. Preserve zero capitalization for ETF proxies.

**Regression check:** Repair a BTC price and check the derived capitalization; verify that VOO/GLD retain their existing semantics.

## Checks actually run

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Exit 0 (`tsc --noEmit`). |
| Focused Vitest command below | ⚠️ 71 passed; one test timed out. Eight files passed; one file failed. Total 63.88 seconds. |
| Isolated retry below | ✅ Timed-out test passed in isolation: one passed, seven skipped; total 30.18 seconds, test execution 27.07 seconds. This does not make the initial parallel run green. |
| Workflow staging dry run | ❌ Exit 128, confirming finding 1. No files were staged. |
| Targeted Node/VM reproductions | ✅ Assertions confirmed the current incorrect behavior described above. VM cache writes were in memory. No production or checked-in data was changed. |

Initial focused test command:

```sh
npm test -- functions/api/market-data.test.ts workers/market-quote-refresh/src/index.test.ts workers/market-quote-refresh/src/normalize.test.ts src/lib/__tests__/marketDataClient.test.ts src/lib/__tests__/usMarketCalendar.test.ts src/lib/__tests__/forecastInterval.test.ts src/lib/__tests__/csrV1.test.ts src/lib/__tests__/gold365V2.test.ts src/server/__tests__/forecastApi.test.ts
```

The timed-out test was `GLD 365-day ridge challenger > applies only at the 365-day horizon`, with an explicit 30-second limit. Its first execution took 48.314 seconds while the suites ran together. The isolated retry passed:

```sh
npm test -- src/lib/__tests__/gold365V2.test.ts -t 'applies only at the 365-day horizon' --maxWorkers=1
```

## Reproduce a cross-model mismatch in one command

Run from the repository root with the installed dependencies:

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { loadMarketData } from './src/lib/api.ts';
import { buildMarketForecast } from './src/lib/marketForecast.ts';
import { countUsMarketSessionsAfter } from './shared/us-market-calendar.mjs';

const result = buildMarketForecast(
  'sp500', loadMarketData('sp500'), 60, 1.6448536269514722
);
const path = result.displayData.at(-1);
console.log({ pathMedian: path.forecast, summaryMedian: result.probabilityForecast.median });
assert.notEqual(path.forecast, result.probabilityForecast.median);

console.log({
  dateString: countUsMarketSessionsAfter('2026-08-17', '2026-08-20'),
  intradayDate: countUsMarketSessionsAfter('2026-08-17', new Date('2026-08-20T23:15:00Z')),
});
JS
```

## Limits and verdict

**Not checked:** Live production endpoints or D1 contents, production traffic/capacity, dependency vulnerability advisories, a browser/visual pass, the full test suite, build, and full backtest. No claims about current production incidents or a new model's predictive quality follow from this scan. Numerical heatmap checks inspect generated samples/cells; they do not assert a visually verified browser appearance.

**Verdict:** Fix the publishing failure and cache-deletion path first. The remaining findings need focused regressions before fixes; forecast/input/distribution changes must pass the repository's relevant validation gates before release.
