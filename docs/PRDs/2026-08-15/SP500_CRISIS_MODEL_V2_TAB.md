---
prd_contract: v1
---

# PRD: S&P 500 Crisis Challenger v2 Context Tab

Complexity: 5 -> MEDIUM mode

## Context

The forecaster already has a generic `S&P 500`/VOO price tab. The supplied
`sp500-crisis-model-v2.zip` is a different capability: a leakage-controlled
second-stage mapper that converts an existing S&P 500 base classifier's raw
probability into a calibrated 63-trading-day crisis probability. It does not
contain the 23-feature base classifier and cannot recompute a fresh raw score
inside this browser app.

Files and artifacts analyzed:

- `src/App.tsx`
- `src/lib/api.ts`
- `src/lib/marketForecast.ts`
- `src/components/workspace/MarketBar.tsx`
- `src/components/workspace/EvidencePanel.tsx`
- `src/server/ForecastController.ts`
- `sp500-crisis-model-v2.zip` (`MODEL_CARD.md`, `data/oos_predictions.csv`, `artifacts/current_score.json`, and `artifacts/comparison.json`)

Implementation source location: the supplied archive remains at
`/home/joao/projects/bitcoin-forecast-visualizer/sp500-crisis-model-v2.zip` in
the manager workspace. The worker may read that explicit user-provided path (or
the repository-root-relative path from its worktree) to generate the snapshot;
the archive itself must not be copied into the web bundle or committed as model
runtime code.

Current behavior:

- `btc`, `sp500`, and `gold` are registered as reusable market tabs.
- The existing `sp500` tab forecasts VOO price behavior with the generic
  log-return model; it is not a crisis-risk classifier.
- Runtime model summaries are imported as checked-in JSON, while the supplied
  challenger is serialized as Python/joblib and is not browser-loadable.
- The challenger improves all four locked 2016-2025 headline metrics in the
  supplied artifact, but every reported uncertainty interval crosses zero and
  the model card explicitly recommends shadow mode.

## Solution

- Add a separate `Crisis` market tab backed by the same VOO price history but a
  distinct, clearly labeled crisis-risk context surface; the existing `S&P 500`
  price tab remains unchanged.
- Convert the supplied model's browser-relevant outputs into one typed,
  checked-in JSON snapshot: current incumbent/challenger scores, thresholds,
  locked holdout metrics, limitations, and the OOS weekly risk history. Do not
  ship or execute the Python joblib model in the browser.
- Add a small model adapter that exposes the imported snapshot, computes
  `NORMAL`/`WATCH`/`HIGH` from the frozen deployment thresholds, and marks the
  result as `shadow`/context-only. It must never replace the VOO price forecast
  or mutate the shared forecast probability.
- Add a crisis-risk panel with the current score, base-score provenance, model
  date, thresholds, holdout comparison, a compact historical challenger-risk
  chart, and an explicit stale/imported-data warning when the score date lags
  the quote date.
- Reuse the existing VOO chart, forecast controls, tab keyboard behavior, and
  market-data refresh path for the new tab. Hide Bitcoin-only overlays as on the
  existing non-BTC tabs.

Data changes: add a browser-safe snapshot derived from the supplied ZIP and a
result report that preserves the ZIP's metrics and caveats. No external API,
database schema, or forecast input is added.

## Integration Points

**Entry point:** the existing `MarketBar` tablist in `src/App.tsx`; the new
`Crisis` tab has `MarketAssetId = 'sp500-crisis'` and defaults nowhere—BTC
remains the default.

**Pre-existing caller:** `src/App.tsx` already registers `MARKET_ASSETS`, loads
each `MarketAssetId`, calls `buildMarketForecast`, and renders the shared
workspace. The implementation extends those calls and adds one conditional
crisis panel in the live render path.

**Registration/wiring:** `MARKET_ASSETS` and `ForecastController` expose the
new id; `loadMarketData('sp500-crisis')` aliases the validated VOO cache;
`buildMarketForecast('sp500-crisis', ...)` follows the existing generic VOO
price model; `CrisisRiskPanel` consumes the typed challenger snapshot.

**User flow:** open the app -> select `Crisis` -> see the imported challenger
score and operational zone -> inspect the historical risk context and holdout
comparison -> use the shared VOO chart and horizon controls without the crisis
score changing the price forecast.

**What this replaces:** nothing. The generic `S&P 500` price tab remains the
incumbent price-forecast path; the new challenger is additive and context-only.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `sp500-crisis-model.json` browser snapshot | `src/lib/sp500CrisisModel.ts:32` loads it; `src/App.tsx:343` renders its result | none | n/a | remove the snapshot import; model-adapter test and crisis tab must fail |
| 2 | `sp500CrisisModel` adapter and zone classifier | `src/components/workspace/CrisisRiskPanel.tsx:18` calls `getCurrentCrisisRisk` | none | n/a | return an empty snapshot; the panel integration test must fail |
| 3 | `MarketAssetId = 'sp500-crisis'` registry entry | `src/App.tsx:326` passes `MARKET_ASSETS` to the live `MarketBar` | none | n/a | remove the registry row; the crisis tab E2E must fail |
| 4 | crisis tab's VOO forecast route | `src/App.tsx:194` calls `buildMarketForecast(activeAssetId, ...)` | none | n/a | route the id to no forecast; crisis-tab smoke must fail |
| 5 | `CrisisRiskPanel` user-facing surface | `src/App.tsx:336` renders it for the active crisis id | none | n/a | remove the conditional render; crisis-tab E2E must fail |
| 6 | model unit gate | `src/lib/sp500CrisisModel.ts:32` exposes the validated adapter contract | none | n/a | disable snapshot validation; the exact unit command must exit non-zero |
| 7 | browser integration gate | `src/App.tsx:336` reaches the crisis surface from the live workspace | none | n/a | disable crisis registration; the exact E2E command must exit non-zero |

## 4. Execution Phases

### Phase 1: Frozen Challenger Snapshot - the imported model is loadable and auditable

**Files (5):**

- `src/data/sp500-crisis-model.json` - NEW: browser-safe snapshot derived from the supplied ZIP's OOS predictions, current score, comparison metrics, thresholds, and limitations.
- `src/lib/sp500CrisisModel.ts` - NEW: typed snapshot contract, zone classifier, stale-date check, and context-only accessors.
- `src/lib/__tests__/sp500CrisisModel.test.ts` - NEW: validates the snapshot schema, current score, threshold ordering, OOS history, and model caveat flags.
- `src/lib/api.ts` - EDIT: add `sp500-crisis` to the asset id and alias its market data to the existing VOO loader.
- `docs/reports/experiments-backlog.md` - EDIT: register the challenger result before runtime integration and keep its verdict context-only.

**Implementation:**

- [ ] Extract only deterministic browser data from the ZIP; preserve source dates, target definition, deployment thresholds, current score, holdout metrics, and uncertainty intervals.
- [ ] Reject malformed probabilities, non-monotonic threshold definitions, missing current-score provenance, and empty OOS history at module load/test time.
- [ ] Keep `raw_probability` and challenger probability visibly distinct; do not infer a new raw score from VOO price data.
- [ ] Mark the snapshot `shadow` and report-only until the registered validation gate authorizes promotion.

**Wiring (the phase is not done without this):**

- [ ] Caller edited: `src/lib/api.ts:158` accepts the new asset id and returns the existing VOO quote data.
- [ ] Registration: `sp500-crisis-model.json` is imported by the adapter and its source archive is named in the backlog/report.
- [ ] Old path: n/a; the existing `sp500` loader remains unchanged.
- [ ] Ledger rows filled: #1, #2, #6.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `src/lib/__tests__/sp500CrisisModel.test.ts` | `should expose the imported current score when the snapshot is valid` | current score, date, thresholds, and `NORMAL` zone match the supplied artifact | remove the current score from the JSON; the test fails |
| `src/lib/__tests__/sp500CrisisModel.test.ts` | `should reject a snapshot with an invalid probability` | validation throws for a probability outside `[0, 1]` | bypass validation; the malformed-fixture assertion fails |
| `src/lib/__tests__/sp500CrisisModel.test.ts` | `should mark a score stale when the quote is newer` | stale status is true only when quote date is later than the imported score date | disable the date comparison; the stale-fixture assertion fails |

**Revert check:** remove the snapshot and adapter import; the pre-existing
crisis-tab integration test added in Phase 3 must fail to compile or render the
model surface.

**Verification Plan:** run the unit command, inspect the raw JSON values against
the ZIP artifacts, run the caller census for `getCurrentCrisisRisk`, and record
one deliberate malformed-snapshot red result before accepting the checkpoint.

**User Verification:** open the eventual `Crisis` tab after Phase 3 -> the
current score must display its imported as-of date and `shadow` status; it must
not claim a live recomputation.

### Phase 2: Asset Registration - the new tab uses the shared VOO forecast path

**Files (4):**

- `src/lib/marketForecast.ts` - EDIT: register the crisis asset metadata and route its price context through the existing S&P 500 generic model.
- `src/App.tsx` - EDIT: initialize/load the new asset, preserve BTC as default, and pass the active crisis id through shared forecast state.
- `src/server/ForecastController.ts` - EDIT: expose the new asset through the existing server asset registry and validation path.
- `src/server/__tests__/forecastApi.test.ts` - EDIT: assert that the crisis asset is listed and accepted without changing the incumbent assets.

**Implementation:**

- [ ] Add `sp500-crisis` metadata with visible label `S&P 500 Crisis`, tab label `Crisis`, VOO ticker/source, and no Bitcoin-only capabilities.
- [ ] Reuse the existing VOO OHLCV cache and generic price forecast; the challenger probability must not enter `buildMarketForecast` or `ForecastSummary`.
- [ ] Keep `sp500`, `gold`, and `btc` behavior and server validation unchanged.
- [ ] Ensure switching tabs triggers the same cleanup/refresh lifecycle as the existing market tabs.

**Wiring (the phase is not done without this):**

- [ ] Caller edited: `src/App.tsx:194` computes a forecast for `sp500-crisis` through the shared live path.
- [ ] Registration: `MARKET_ASSETS` and `ForecastController` include the id; `MarketBar` receives it through the existing registry.
- [ ] Old path: existing `sp500` remains the generic VOO forecast and is not replaced.
- [ ] Ledger rows filled: #3, #4.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `src/server/__tests__/forecastApi.test.ts` | `should list and accept the S&P 500 crisis asset` | asset metadata includes `sp500-crisis`, and a forecast request is valid | remove the registry entry; the API assertion fails |
| `src/components/__tests__/ForecastWorkspace.test.tsx` | `should navigate to the crisis tab with the shared tablist` | ArrowRight/click reaches `Crisis` while BTC remains the initial asset | omit the new asset from `MARKET_ASSETS`; navigation assertion fails |

**Revert check:** temporarily remove the `sp500-crisis` registry row; the new
server and tab tests must fail while existing BTC/S&P/Gold tests remain green.

**Verification Plan:** run the focused API/component tests, `yarn lint`, and
`yarn build`; record the registry-disabled red test before the checkpoint.

**User Verification:** select `Crisis` -> the quote and shared VOO chart render,
the existing `S&P 500` tab still works, and the browser URL/state does not imply
that the crisis model changed the price forecast.

### Phase 3: Crisis Risk Surface - the user can inspect the challenger in the live tab

**Files (10):**

- `src/components/workspace/CrisisRiskPanel.tsx` - NEW: current risk card, threshold legend, holdout comparison, historical OOS risk chart, and shadow/staleness copy.
- `src/App.tsx` - EDIT: render `CrisisRiskPanel` only for the crisis asset and pass the current VOO quote date.
- `src/index.css` - EDIT: add only the compact responsive chart/card styles required by the new panel.
- `src/components/__tests__/CrisisRiskPanel.test.tsx` - NEW: verifies accessible current-risk text, threshold labels, caveat copy, and historical data rendering.
- `src/components/__tests__/App.marketData.test.tsx` - EDIT: verifies VOO is hydrated once and the exact data/status are shared by both S&P 500 tabs.
- `tests/e2e/forecast-workspace.spec.ts` - EDIT: drive the Crisis tab at desktop/mobile widths and verify the panel and shared chart flow.
- `tests/e2e/forecast-workspace.spec.ts-snapshots/chart-settings-desktop-linux.png` - EDIT: refresh the stable desktop screenshot after adding the visible Crisis tab.
- `tests/e2e/forecast-workspace.spec.ts-snapshots/evidence-data-desktop-linux.png` - EDIT: refresh the stable evidence screenshot after adding the visible Crisis tab.
- `tests/e2e/forecast-workspace.spec.ts-snapshots/forecast-workspace-desktop-linux.png` - EDIT: refresh the stable desktop workspace screenshot after adding the visible Crisis tab.
- `tests/e2e/forecast-workspace.spec.ts-snapshots/forecast-workspace-mobile-linux.png` - EDIT: refresh the stable mobile workspace screenshot after adding the visible Crisis tab.

**Implementation:**

- [ ] Make the primary value the challenger deployment probability and show the incumbent probability beside it; never present the challenger number as a price or as a live base-model recomputation.
- [ ] Show `NORMAL`, `WATCH`, or `HIGH` using the imported deployment thresholds and include the score date, quote date, model target definition, and `shadow mode` label.
- [ ] Render the OOS history with an accessible text/table fallback and fixed WATCH/HIGH reference labels; limit the visual to the supplied weekly observations.
- [ ] Make stale imported data obvious when `asOfDate < quoteDate`; do not silently refresh or extrapolate it.
- [ ] Preserve keyboard navigation, reduced-motion behavior, no horizontal overflow at 390px/200% zoom, and the existing chart settings behavior.

**Wiring (the phase is not done without this):**

- [ ] Caller edited: `src/App.tsx:336` renders the panel in the real crisis-tab branch.
- [ ] Registration: the panel is reachable only through the `Crisis` tab and reads the same imported snapshot as the adapter tests.
- [ ] Old path: no incumbent panel is removed; the generic S&P price tab remains unchanged.
- [ ] Ledger rows filled: #1, #2, #5, #7.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `src/components/__tests__/CrisisRiskPanel.test.tsx` | `should show the shadow challenger zone and provenance` | current deployment probability, `NORMAL`, as-of date, and shadow copy are visible | remove the panel render; the live component assertion fails |
| `src/components/__tests__/CrisisRiskPanel.test.tsx` | `should show threshold and history context without calling the price forecast` | WATCH/HIGH labels and OOS points render; no price-forecast override text appears | pass an empty history or add an override; the assertion fails |
| `tests/e2e/forecast-workspace.spec.ts` | `should open the crisis tab and keep the shared workspace usable` | tab selection shows the crisis panel, generic VOO chart, controls, and no critical accessibility violations | remove crisis registration; the tab selection assertion fails |

**Revert check:** remove the conditional `CrisisRiskPanel` render from
`src/App.tsx`; the focused component/E2E flow must fail to find the user-facing
crisis-risk surface.

**Verification Plan:** run focused component tests, the full unit suite, the
crisis E2E slice at 390px and 1440px, `yarn lint`, and `yarn build`. Deliberately
disable the render once and capture the expected red E2E result.

**User Verification:** click `Crisis` -> read the current zone and score date,
inspect the historical risk chart, then change the shared horizon -> the VOO
price forecast updates while the imported crisis snapshot remains visibly
unchanged and context-only.

### Phase 4: Evidence and Release Guard - the tab is documented and cannot be mistaken for a promoted signal

**Files (4):**

- `README.md` - EDIT: document the Crisis tab, imported snapshot date semantics, and shadow-mode limitation.
- `docs/reports/data-sources.md` - EDIT: document the supplied ZIP provenance, VOO context source, model target, and no-live-recompute boundary.
- `docs/reports/results/sp500-crisis-model-v2-2026-08-15.md` - EDIT: attach the human-readable result summary, metrics, uncertainty, and verdict to the runtime-facing evidence set.
- `docs/reports/results/sp500-crisis-model-v2-2026-08-15.json` - EDIT: preserve machine-readable metrics, thresholds, source dates, and current snapshot values.

**Implementation:**

- [ ] Link the PRD and result artifacts from the documentation without copying the Python joblib into the web bundle.
- [ ] State that the positive locked-holdout result is promising but statistically uncertain, and that runtime presentation is context-only.
- [ ] Document rerun criteria: a new unseen period/crisis, refreshed base-score snapshot, or a separately registered validation experiment; no ad-hoc threshold tuning.

**Wiring (the phase is not done without this):**

- [ ] Caller edited: `README.md` links a developer to the live `Crisis` tab and its evidence artifacts.
- [ ] Registration: report JSON/Markdown paths are stable and referenced by the backlog and PRD.
- [ ] Old path: existing S&P/VOO documentation remains valid.
- [ ] Ledger rows filled: #1, #7.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `src/lib/__tests__/sp500CrisisModel.test.ts` | `should keep the runtime artifact verdict context-only` | snapshot verdict and report agree that promotion is disabled | change verdict to promoted; assertion fails |
| `yarn lint` | `should compile the documented runtime surface` | TypeScript exits 0 | break the report import/type; command exits non-zero |
| `yarn build` | `should bundle the reachable crisis tab` | Vite exits 0 and the crisis module is included | break the crisis component import; command exits non-zero |

**Revert check:** remove the result artifact links and the runtime summary
reference; the documentation/evidence test must fail its artifact-presence
assertion.

**Verification Plan:** run `yarn test --run`, `yarn lint`, `yarn build`, the
relevant `yarn backtest` regression gate, and the crisis E2E slice. Confirm the
result report is preserved under `docs/reports/results/` and contains no claim
that the challenger is promoted.

**User Verification:** follow the README link -> the model card, current score,
holdout metrics, uncertainty, and shadow-mode limitation are inspectable without
opening the ZIP or reading implementation code.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
|---|---|---|---|
| crisis-model-adapter | remove the current score or snapshot import | adapter test exits non-zero | `command: yarn vitest run src/lib/__tests__/sp500CrisisModel.test.ts`; result: RED observed: imported crisis snapshot unavailable; exit: 1 |
| crisis-tab-registration | remove the `sp500-crisis` registry row | tab/API assertion exits non-zero | `command: yarn vitest run src/components/__tests__/ForecastWorkspace.test.tsx src/server/__tests__/forecastApi.test.ts`; result: RED observed: Crisis asset missing from live registry; exit: 1 |
| crisis-tab-e2e | remove the conditional `CrisisRiskPanel` render | browser flow exits non-zero | `command: yarn playwright test tests/e2e/forecast-workspace.spec.ts --grep "crisis"`; result: RED observed: Crisis risk panel not found; exit: 1 |
| typecheck | introduce an invalid crisis snapshot field reference | TypeScript exits non-zero | `command: yarn lint`; result: RED observed: invalid crisis snapshot type; exit: 2 |
| production-build | break the crisis panel import | Vite exits non-zero | `command: yarn build`; result: RED observed: crisis panel module cannot be resolved; exit: 1 |
| forecast-regression | route the crisis tab through an unvalidated forecast override | forecast regression exits non-zero | `command: yarn backtest`; result: RED observed: context-only integration changed the accepted forecast path; exit: 1 |

## Acceptance Criteria

- [ ] BTC remains the default tab and all existing BTC, S&P 500, and Gold tab flows continue to work.
- [ ] A visible, keyboard-accessible `Crisis` tab reaches a live crisis-risk surface without replacing the existing `S&P 500` price tab.
- [ ] The crisis surface displays the supplied current incumbent/challenger scores, deployment thresholds, model date, target definition, and `NORMAL`/`WATCH`/`HIGH` zone from the checked-in snapshot.
- [ ] The surface shows the OOS challenger history and locked 2016-2025 comparison, including uncertainty caveats, with an accessible fallback.
- [ ] The current score is explicitly labeled imported/shadow/context-only and becomes visibly stale when its as-of date lags the current VOO quote; no score is silently extrapolated.
- [ ] The challenger never changes `buildMarketForecast`, the shared VOO price forecast, the generic `probabilityForecast`, or any existing asset's output.
- [ ] `yarn test --run`, `yarn lint`, `yarn build`, the relevant `yarn backtest` gate, and the crisis E2E/accessibility flow pass; each gate has an observed-red negative control recorded.
- [ ] The Integration Ledger has zero `TBD` cells, every new exported symbol has a non-test caller, and the revert check proves the crisis tab is actually integrated.
- [ ] Report artifacts are preserved under `docs/reports/results/`, linked from the backlog/README, and state that v2 remains unpromoted pending a genuinely unseen period or stronger validation.

## Checkpoint Protocol

After each phase, record in the implementation handoff:

1. The exact focused test/build/backtest command and raw exit result.
2. A non-test caller census for every new exported symbol, including the live
   `CrisisRiskPanel` branch and snapshot loader.
3. The revert check result: the pre-existing or newly integrated live flow must
   fail when the new code is disabled.
4. The exact observed-red result for every gate in `## Negative Controls`; a
   green-only run is `UNVERIFIED`.
5. The source/archive date and current snapshot date, plus whether the score is
   stale relative to the active VOO quote.

Delivery is blocked if the crisis panel is only reachable from tests, if the
challenger probability enters the price forecast path, if any threshold or
source date is silently invented, if the snapshot is stale without an explicit
warning, or if the supplied model's uncertainty is omitted from the user-facing
surface.

Verification evidence must include: `Contract conformance: prd_contract: v1`.
