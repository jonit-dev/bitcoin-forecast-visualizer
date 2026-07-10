# PRD: Daily Production Market Quote Refresh

Complexity: 6 -> MEDIUM mode

Status: Proposed

Owner: Engineering

Target: Cloudflare Pages + Workers

## 1. Context

**Problem:** Production BTC, S&P 500, and gold quotes are frozen into the deployed bundle and only become fresh when a developer updates JSON files and redeploys.

**Files analyzed:**

- `wrangler.toml`
- `package.json`
- `.env.example`
- `scripts/update-btc-data.mjs`
- `scripts/update-market-data.mjs`
- `scripts/check-data-freshness.ts`
- `src/lib/api.ts`
- `src/lib/marketForecast.ts`
- `src/App.tsx`
- `functions/api/assets.ts`
- `functions/api/forecast.ts`
- `src/server/ForecastController.ts`
- `docs/PRDs/v2/07-market-data-quality-upgrade.md`
- `docs/reports/data-sources.md`

**Current behavior:**

- BTC, VOO (the S&P 500 proxy), and GLD (the gold proxy) are imported synchronously from checked-in JSON.
- `predev` refreshes local files; `deploy` refreshes BTC before building, but production has no autonomous refresh.
- Pages Functions calculate API forecasts from the same build-time JSON, so `/api/forecast` also goes stale between deployments.
- The browser initializes all three assets from bundled data and has no remote hydration path.
- `wrangler.toml` configures a Pages project only; there is no mutable data binding or scheduled Worker.

### Goals

- Persist one canonical completed daily OHLCV candle per supported asset in production.
- Refresh BTC every UTC day and VOO/GLD after US market sessions, tolerating weekends and holidays.
- Make the chart, headline quote, and `/api/forecast` consume the same newest validated data.
- Keep forecast formulas unchanged and preserve bundled JSON as a read fallback.
- Make reruns idempotent, failures visible, and stale data explicit.
- Make adding another daily market proxy configuration-driven.

### Non-goals

- Intraday or streaming quotes.
- Replacing VOO with the S&P 500 cash index or GLD with physical spot gold.
- Changing any forecast coefficients, features, intervals, or calibration.
- Scheduling all existing on-chain, macro, derivatives, sentiment, COT, or report pipelines.
- Committing runtime-fetched candles back to Git or triggering a daily Pages deployment.

## 2. Solution

### Approach

- Add a dedicated Cloudflare Worker with a Cron Trigger. Cloudflare cron expressions run in UTC; schedule the job once daily after both the prior UTC BTC candle and the US session data should be available.
- Store normalized candles and refresh-run metadata in Cloudflare D1. Bind the same database to the scheduled Worker and Pages Functions.
- Extract source fetching, normalization, validation, and merge rules into runtime-compatible modules with no Node filesystem dependency. Existing CLI updaters may call the same pure logic later, but parity is required before replacing their file-writing paths.
- Add a Pages endpoint that returns validated rows newer than a caller-provided date. The browser merges these rows over the bundled snapshot; `/api/forecast` performs the equivalent server-side merge before calculating.
- Treat upstream failure as a failed run, never as permission to erase or replace the last valid candle. Surface source date and refresh status separately from `generatedAt`.

### Why D1 and a separate Worker

- A deployed Pages bundle is immutable; runtime code cannot durably rewrite `src/data/*.json`.
- Pages Functions can use bindings, but scheduling belongs on a Worker Cron Trigger. A separate Worker keeps the existing Pages deployment intact and shares D1 through bindings.
- Daily rows are relational, naturally keyed by `(asset_id, date)`, and small enough for D1. D1 also supports atomic upserts and operational queries without introducing object-manifest coordination.
- A daily CI job that edits Git and redeploys is rejected as the primary design because it couples data freshness to source-control writes, build availability, and deployment success.

### Architecture

```mermaid
flowchart LR
  Cron[Cloudflare Cron Trigger] --> Worker[market-quote-refresh Worker]
  Worker --> Sources[CoinGecko / Yahoo chart sources]
  Worker --> Validate[normalize + validate completed candles]
  Validate --> D1[(D1 market_candles + refresh_runs)]
  D1 --> PagesAPI[Pages Functions]
  Bundle[Bundled JSON fallback] --> PagesAPI
  Bundle --> Browser[React app]
  PagesAPI --> Browser
  PagesAPI --> Forecast[/api/forecast]
  Browser --> Merge[merge rows newer than bundled max date]
```

### Key decisions

- **Cadence:** configure `15 23 * * *` UTC as the initial trigger. BTC ingestion selects only the last completed UTC day. VOO/GLD accept the latest completed exchange session returned by the source, so weekends and holidays produce a successful no-op.
- **Asset identity:** continue using `btc`, `sp500`, and `gold`; source symbols remain BTC/USD, VOO, and GLD.
- **Canonical row:** `{ assetId, date, open, high, low, close, volume, source, sourceTimestamp, ingestedAt }`.
- **Write rule:** `INSERT ... ON CONFLICT(asset_id, date) DO UPDATE` only when the incoming row passes validation. Repaired source candles may update the configurable recent lookback, initially seven calendar days.
- **Read rule:** D1 rows take precedence for matching dates; checked-in JSON fills older history and is the complete fallback.
- **Freshness:** BTC warns after 2 calendar days; VOO/GLD warn after 3 US business days. Weekend/holiday no-op is not a failure.
- **Failure isolation:** process assets independently, record per-asset results, and fail the overall run if any asset has neither a valid update/no-op nor a usable cached row.
- **Source policy:** keep current sources initially. This PRD operationalizes already-used data; it does not validate a new forecast signal. Source replacement still requires the market-data quality PRD and backtest gates.
- **Security:** the scheduled handler is not exposed as an unauthenticated mutation endpoint. Optional manual execution uses `wrangler ... triggers deploy`/local scheduled testing or a protected admin route with a Worker secret.

### Data changes

Migration `migrations/0001_market_quotes.sql`:

```sql
CREATE TABLE market_candles (
  asset_id TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL CHECK (open > 0),
  high REAL NOT NULL CHECK (high > 0),
  low REAL NOT NULL CHECK (low > 0),
  close REAL NOT NULL CHECK (close > 0),
  volume REAL NOT NULL CHECK (volume >= 0),
  source TEXT NOT NULL,
  source_timestamp TEXT,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, date),
  CHECK (high >= low AND high >= open AND high >= close AND low <= open AND low <= close)
);

CREATE TABLE refresh_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  asset_results_json TEXT NOT NULL,
  error_summary TEXT
);

CREATE INDEX market_candles_asset_date_desc
  ON market_candles(asset_id, date DESC);
```

No existing JSON schema changes are required.

## 3. Integration Points

**How will this feature be reached?**

- Entry point: Cloudflare Cron Trigger invokes the Worker's `scheduled()` handler daily.
- Caller: `workers/market-quote-refresh/src/index.ts` invokes the refresh service for the configured assets.
- Wiring: a Worker Wrangler config declares the cron and D1 binding; Pages `wrangler.toml` declares the same D1 database binding; D1 migrations are deployed before either consumer.

**Is this user-facing?** Yes, indirectly and directly.

- The existing chart and headline metrics show newly hydrated daily rows.
- `/api/forecast` anchors calculations to the same latest validated close.
- A compact freshness state distinguishes current, delayed, fallback, and unavailable data. Broader layout changes belong to the separate UI/UX polishing PRD.

**Full user flow:**

1. Cloudflare invokes the Worker after the daily data-availability window.
2. The Worker fetches a bounded repair window for each asset, validates it, and idempotently upserts D1.
3. A user opens production; bundled history renders immediately.
4. The browser calls `GET /api/market-data?asset=btc&since=<bundle-last-date>` and merges newer rows.
5. Forecast generation uses the hydrated series in the browser; programmatic `/api/forecast` merges the same D1 rows server-side.
6. The UI shows the source candle date and a stale/fallback indicator when applicable.

### API contract

`GET /api/market-data?asset=btc&since=2026-07-01`

```json
{
  "asset": "btc",
  "rows": [{ "date": "2026-07-09", "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1 }],
  "latestDate": "2026-07-09",
  "source": "coingecko",
  "refreshedAt": "2026-07-10T23:15:00.000Z",
  "status": "current"
}
```

Requirements:

- Validate `asset` against the configured allowlist and `since` as `YYYY-MM-DD`.
- Return at most the bounded repair window for normal client hydration; allow a full-history administrative/debug mode only if a demonstrated need exists.
- Use `Cache-Control` with a short edge TTL and ETag keyed by `asset/latestDate`.
- Return a successful bundled-fallback response when D1 is unavailable, with `status: "fallback"`; never label request time as market-data freshness.

## 4. Sequence Flow

```mermaid
sequenceDiagram
  participant C as Cron
  participant W as Quote Worker
  participant S as Upstream Sources
  participant DB as D1
  participant P as Pages Function
  participant U as Browser
  C->>W: scheduled() at 23:15 UTC
  W->>DB: create refresh_runs(running)
  loop btc, sp500, gold
    W->>S: fetch bounded completed-candle window
    alt invalid or upstream failure
      W->>DB: record asset failure; preserve candles
    else valid rows
      W->>DB: transactionally upsert by asset/date
      W->>DB: record updated or no-op result
    end
  end
  W->>DB: finalize refresh run
  U->>P: GET market-data?asset&since
  P->>DB: select newer rows + latest run
  DB-->>P: rows and freshness metadata
  P-->>U: delta or explicit fallback
  U->>U: validate, merge, recalculate display
```

## 5. Execution Phases

#### Phase 1: Runtime-safe ingestion contract - Source responses become validated canonical rows

**Files (max 5):**

- `workers/market-quote-refresh/src/assets.ts` - asset/source configuration.
- `workers/market-quote-refresh/src/sources.ts` - bounded CoinGecko and Yahoo fetch adapters.
- `workers/market-quote-refresh/src/normalize.ts` - canonical normalization and row validation.
- `workers/market-quote-refresh/src/normalize.test.ts` - fixtures and validation tests.
- `package.json` - focused test/typecheck commands if needed.

**Implementation:**

- [ ] Define an exhaustive asset registry for BTC, VOO, and GLD.
- [ ] Port current adjustment behavior without filesystem imports.
- [ ] Fetch only a seven-day repair window; do not download full history daily.
- [ ] Exclude partial BTC UTC candles and incomplete equity sessions.
- [ ] Reject duplicate dates, malformed OHLC, negative volume, non-finite values, and unexpected source shapes.
- [ ] Use bounded timeout, abort, and retry with jitter for 429/5xx responses; do not retry permanent 4xx responses.

**Tests required:**

| Test file | Test name | Assertion |
| --- | --- | --- |
| `normalize.test.ts` | `should normalize completed BTC candles when CoinGecko response is valid` | exact canonical rows and UTC dates |
| `normalize.test.ts` | `should apply adjusted close ratio when Yahoo returns a split or dividend adjustment` | OHLC and close match current convention |
| `normalize.test.ts` | `should reject a partial candle when UTC day is incomplete` | no partial row emitted |
| `normalize.test.ts` | `should reject malformed OHLC when high is below close` | explicit typed error |
| `normalize.test.ts` | `should treat a closed-market response as a no-op when no new session exists` | success with zero rows |

**Verification plan:** Run focused Vitest tests and `npm run lint`; compare adapter output for a captured fixture with the existing updater output.

**User verification:** Run the adapter against fixtures and inspect canonical BTC/VOO/GLD rows; no production or checked-in data changes occur.

#### Phase 2: D1 persistence and idempotent scheduled refresh - Daily runs persist safely

**Files (max 5):**

- `migrations/0001_market_quotes.sql` - candles, run log, constraints, and index.
- `workers/market-quote-refresh/src/repository.ts` - D1 transactions and queries.
- `workers/market-quote-refresh/src/index.ts` - `scheduled()` orchestration and per-asset isolation.
- `workers/market-quote-refresh/wrangler.toml` - Worker name, compatibility date, D1 binding, and cron.
- `workers/market-quote-refresh/src/index.test.ts` - scheduled integration tests with mocked fetch/D1.

**Implementation:**

- [ ] Create and document local/preview/production D1 databases; never reuse production binding in tests.
- [ ] Upsert valid recent rows by composite primary key in a transaction.
- [ ] Record run and per-asset outcomes: `updated`, `no-op`, or `failed`.
- [ ] Use `ctx.waitUntil()` for scheduled work and ensure the promise captures failures.
- [ ] Make the second identical invocation produce no duplicate rows and an explicit no-op/update-count result.
- [ ] Configure `15 23 * * *`; document that Cron Trigger changes may take time to propagate.

**Tests required:**

| Test file | Test name | Assertion |
| --- | --- | --- |
| `index.test.ts` | `should upsert one candle per asset and date when scheduled event succeeds` | three keyed rows and completed run |
| `index.test.ts` | `should remain idempotent when the same scheduled event runs twice` | row count unchanged |
| `index.test.ts` | `should preserve existing candle when one source returns invalid data` | prior row remains and failure recorded |
| `index.test.ts` | `should update successful assets when another asset fails` | partial success is explicit |
| migration command | `should apply migration to local D1 when database is empty` | schema and constraints exist |

**Verification plan:** Apply local migrations, invoke the local scheduled endpoint supported by Wrangler, query D1, rerun, and compare row counts and run records.

**User verification:** A manually invoked local cron writes valid rows and a second run is safe.

#### Phase 3: Production read API and forecast parity - APIs use the newest validated candle

**Files (max 5):**

- `wrangler.toml` - Pages D1 binding.
- `functions/api/market-data.ts` - delta and freshness endpoint.
- `functions/api/forecast.ts` - async D1-plus-bundle merge before forecasting.
- `functions/_shared/marketDataRepository.ts` - shared read/merge/fallback rules.
- `src/server/__tests__/forecastApi.test.ts` - API freshness and fallback tests.

**Implementation:**

- [ ] Query only allowed assets and rows newer than `since`.
- [ ] Merge by date, sort strictly ascending, and revalidate the result.
- [ ] Make D1 rows authoritative on date collision.
- [ ] Return source candle date, ingestion time, last run state, and calculated freshness status.
- [ ] Use bundled data on missing binding, D1 error, or empty database; expose `fallback` without failing the forecast endpoint.
- [ ] Keep current forecast response fields backward compatible; add freshness metadata additively.

**Tests required:**

| Test file | Test name | Assertion |
| --- | --- | --- |
| API test | `should return rows newer than since when D1 contains a later candle` | delta only, sorted |
| API test | `should use D1 close as forecast anchor when it is newer than bundle` | `latest` equals D1 row |
| API test | `should prefer D1 row when its date collides with bundled history` | repaired row wins once |
| API test | `should return bundled fallback when D1 binding is unavailable` | 200 with fallback status |
| API test | `should reject unsupported asset and malformed since parameters` | 400 response |

**Verification plan:** Run API tests, `npm run lint`, and curl local Pages endpoints with seeded local D1 and without the binding.

**API proof:**

```bash
curl -s "http://localhost:8788/api/market-data?asset=btc&since=2026-07-01"
curl -s "http://localhost:8788/api/forecast?asset=btc&horizon=180&confidence=0.95"
```

**User verification:** Both endpoints report the same newest BTC candle; removing the local D1 binding returns a labeled bundled fallback.

#### Phase 4: Browser hydration and honest freshness - Production users see current daily data

**Files (max 5):**

- `src/lib/api.ts` - remote delta response types and pure merge helper.
- `src/lib/marketDataClient.ts` - fetch/timeout/fallback client.
- `src/App.tsx` - hydrate active assets and recalculate forecasts after merge.
- `src/components/MarketDataStatus.tsx` - compact current/delayed/fallback state.
- `src/lib/__tests__/marketDataClient.test.ts` - merge and failure tests.

**Implementation:**

- [ ] Render immediately from bundled data, then request rows after each asset's bundled max date.
- [ ] Keep asset state updateable and recompute only the affected asset forecast.
- [ ] Prevent an older or malformed remote response from replacing valid bundled data.
- [ ] Display the market candle date, not browser fetch time, as quote freshness.
- [ ] Keep the status compact; defer general information-density redesign to the UI/UX PRD.
- [ ] Make network/D1 failure non-blocking and visibly labeled as fallback.

**Tests required:**

| Test file | Test name | Assertion |
| --- | --- | --- |
| `marketDataClient.test.ts` | `should append a newer remote candle when bundle is older` | latest row and quote update |
| `marketDataClient.test.ts` | `should replace a colliding date with authoritative D1 repair` | no duplicate date |
| `marketDataClient.test.ts` | `should ignore older and malformed remote rows` | bundled series unchanged |
| App component test | `should recalculate active forecast when hydration adds a candle` | forecast anchor updates |
| App component test | `should display fallback status when hydration fails` | chart remains rendered |

**Verification plan:** Run unit/component tests and a local Pages+D1 flow. Confirm BTC daily behavior and VOO/GLD weekend no-op behavior at desktop and mobile widths.

**User verification:** Load production-like local build with a seeded candle newer than the bundle; the quote, chart endpoint, and forecast anchor all advance to it without a rebuild.

#### Phase 5: Deployment, monitoring, and rollback - Operators can prove and recover daily freshness

**Files (max 5):**

- `package.json` - migration, Worker deploy, and smoke commands.
- `README.md` - deployment order, manual trigger, monitoring, and rollback runbook.
- `scripts/check-production-market-data.mjs` - endpoint-level smoke/freshness check.
- `.github/workflows/market-data-watchdog.yml` - optional alerting check independent of cron.
- `.env.example` - only document optional alert webhook/admin secret names; no values.

**Implementation:**

- [ ] Deploy in order: D1 migration, Worker without cron/manual proof, Pages binding/API, browser hydration, then cron enablement.
- [ ] Add smoke checks for all assets, source dates, statuses, and cross-endpoint latest-date agreement.
- [ ] Alert only after configured freshness thresholds to avoid weekend/holiday noise.
- [ ] Document inspecting Worker logs and `refresh_runs`.
- [ ] Rollback by disabling the cron and Pages D1 reads; bundled snapshots keep the app operational. Do not delete D1 data during rollback.
- [ ] Run market forecast and BTC forecast backtest/regression gates to prove that plumbing caused no unintended historical/model change.

**Tests required:**

| Test/command | Test name | Assertion |
| --- | --- | --- |
| production smoke | `should report current BTC and session-aware VOO/GLD data` | exit 0 within thresholds |
| production smoke | `should detect mismatch between market-data and forecast latest dates` | exit non-zero |
| `npm run backtest` | BTC regression gate | pass |
| `npm run backtest:market` | VOO/GLD market-model gate | pass |
| `npm test` + `npm run lint` | repository regression | pass |

**Verification plan:** Perform a preview deployment, manually invoke refresh twice, inspect logs/D1, curl both APIs, load the UI, then enable production cron and verify the next scheduled run.

**User verification:** The next completed daily run advances the correct assets, the watchdog passes, and rollback to bundled data is documented and tested.

## 6. Checkpoint Protocol

After every implementation phase:

1. Run that phase's focused tests and the relevant repository regression commands.
2. Use the `prd-work-reviewer` checkpoint agent required by the `prd-creator` workflow to compare implementation with this PRD.
3. Continue only on PASS; correct drift and rerun otherwise.
4. Phases 2 and 5 also require manual verification because they depend on external sources and Cloudflare runtime behavior.

## 7. Acceptance Criteria

- [ ] Cloudflare invokes the production refresh Worker daily on a documented UTC schedule.
- [ ] BTC, VOO, and GLD normalized daily rows persist in D1 with constraints and provenance.
- [ ] Identical reruns do not duplicate rows or corrupt run state.
- [ ] Weekends and market holidays produce expected VOO/GLD no-ops without false alerts.
- [ ] Bad source data cannot overwrite the last valid candle.
- [ ] Browser quote/chart data and `/api/forecast.latest` agree on the newest candle date and close.
- [ ] Production still works from bundled JSON when D1, the Worker, or an upstream source is unavailable.
- [ ] Freshness refers to the source candle date and exposes current/delayed/fallback status.
- [ ] All phase tests, `npm test`, and `npm run lint` pass.
- [ ] `npm run backtest` and `npm run backtest:market` pass without unintended forecast changes.
- [ ] All automated checkpoints pass; external integration checkpoints have manual evidence.
- [ ] Deployment, monitoring, manual rerun, and rollback steps are documented.

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Unofficial Yahoo endpoint changes or throttles | Strict schema validation, bounded retries, per-asset isolation, cached fallback, explicit failure run |
| CoinGecko partial/current UTC candle | Select only completed UTC day; repair recent window on later runs |
| Cron runs before vendor publishes a close | Late UTC schedule, successful no-op semantics, next-run repair window |
| D1 and bundle disagree on a historical date | D1 wins only after validation; store provenance; monitor repairs |
| UI and API calculate from different anchors | Shared merge rules and cross-endpoint smoke assertion |
| Freshness alarm fires on market holiday | Asset calendar/business-day thresholds and no-op run state |
| Runtime data silently changes forecast results | No formula changes; backtest both bundled baseline and merged fixture; retain repository experiment gates |

## 9. Cloudflare references

- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — schedules use UTC and invoke a Worker's scheduled handler.
- [Scheduled handler API](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) — runtime contract for `scheduled(controller, env, ctx)`.
- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/) — Pages Functions can access D1 and service bindings.
- [Wrangler triggers configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#triggers) — cron declaration and deployment configuration.

## 10. Open implementation choices

These do not block the architecture, but Phase 2 must record the selected values:

- Exact D1 database names/IDs for preview and production.
- Alert destination (Cloudflare notification, existing monitoring, or webhook); secrets must stay in Cloudflare secret storage.
- Whether the independent watchdog is enabled immediately or after the first week of observed cron reliability.
- Whether source adapters are later reused by local file update scripts after fixture parity is proven.
