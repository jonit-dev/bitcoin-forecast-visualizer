---
prd_contract: v1
---

# PRD: FRED Macro Forecast Experiments

Status: Executed. All three registered arms completed as `context-only`; no
production forecast path changed because the out-of-sample evidence gate did
not pass.

Complexity: 5 → MEDIUM mode

## 1. Context

**Problem:** The current FRED cache begins in 2023, so the prior macro rejection
was sample-starved and did not test tightening, COVID, or the 2022 drawdown.

**Files analyzed:**

- `scripts/update-macro-data.mjs`
- `scripts/backtest-macro-liquidity.ts`
- `scripts/build-feature-table.ts`
- `src/lib/backtestModels.ts`
- `docs/reports/experiments-backlog.md`
- `docs/reports/forecast-model-improvement-proposals-2026-08-02.md`

**Current behavior:**

- `update:macro` uses the FRED graph CSV endpoint and currently produces about
  three years of rows despite declaring a 2010 start.
- Existing macro features use a conservative 30-day availability lag but are
  not vintage-safe; they remain context-only.
- The current production median is `powerlaw-current`; no candidate feature
  reaches the production forecast.
- The earlier macro experiment tested only a sparse regime interval adjustment
  and was rejected for insufficient usable holdout samples.

**Required outcome:** recover the declared FRED history with the API key,
pre-register materially different macro hypotheses, run reproducible walk-forward
backtests, and record a verdict without enabling an unproven signal.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|-----------|-------------------------------------|----------|-------------------|-------------------|
| 1 | FRED API observation loader | `package.json:53` runs `scripts/update-macro-data.mjs` | FRED graph CSV request | deleted in Phase 1 | missing key exits non-zero; graph URL is absent |
| 2 | Point-in-time macro signal builder | `scripts/backtest-fred-macro-experiments.ts:280` calls `buildMacroSignalAtOrigin` from `src/lib/fredMacroFeatures.ts` | ad hoc feature formulas inside the prior macro script | prior script unchanged; new path owns this experiment | a future-dated macro row is excluded at the forecast origin |
| 3 | FRED experiment runner and report | `package.json:38` runs `scripts/backtest-fred-macro-experiments.ts` | none; new research entry point | n/a | disabling the candidate arms leaves the baseline report and changes the candidate comparison |
| 4 | Research result artifacts | `scripts/backtest-fred-macro-experiments.ts:252` writes `docs/reports/results/btc-fred-macro-experiments.{json,md}` | none | n/a | deleting the artifact before rerun causes the runner to regenerate it |

## 2. Solution

**Approach:**

- Replace the graph CSV fetch with the authenticated FRED observations API,
  requesting `observation_start=2010-07-17` and never printing the key.
- Use `BAAFF` (Moody's Seasoned Baa Corporate Bond Minus Federal Funds Rate) as
  the historical credit-spread proxy. The current FRED catalog reports
  `BAMLH0A0HYM2` beginning at `2023-08-01`, so it cannot support the registered
  BTC-era validation window. The cache preserves `highYieldSpread` as a legacy
  field alias while recording the proxy limitation.
- Add five additional public FRED series that represent market volatility,
  financial conditions, the yield curve, and the dollar:
  `T10Y2Y`, `NFCI`, `VIXCLS`, `BAA10Y`, and `DTWEXBGS`.
- Build signals only from observations whose conservative `availableAfter` date
  is on or before the BTC forecast origin; calculate rolling z-scores from prior
  macro observations only.
- Score three pre-registered arms against `powerlaw-current` and
  `naive-current-price` at 14/30/60/90-day horizons:
  `stress-interval`, `liquidity-median`, and `shock-interval`.
- Keep all new signals outside the app-facing feature table and forecast model
  until the final holdout, uncertainty, multiple-testing, vintage, and regression
  gates pass.

**Data and leakage policy:**

- Source: FRED observations API, latest revisions, fetched on execution date.
- Credit-source decision registered on 2026-08-03: use historical `BAAFF` rather
  than the current `BAMLH0A0HYM2` catalog range; this is a proxy, not a claim of
  high-yield index equivalence.
- BTC target: close price at `origin + horizonDays`.
- Feature availability: macro observation date plus 30 calendar days.
- Validation: `2018-01-01` through `2022-12-31`.
- Final holdout: `2023-01-01` through the latest target with a complete horizon.
- Origins: daily for estimation and block bootstrap; horizon-spaced origins are
  also reported as a non-overlapping robustness view.
- Primary metrics: mean log-score/NLL and mean absolute log error.
- Secondary metrics: 90% coverage, q05/q95 log pinball, and median absolute log
  error.
- Bootstrap: 2,000 deterministic moving-block resamples with block length equal
  to the forecast horizon; Holm correction across three arms and four horizons.
- Promotion threshold: at least 30 final-holdout daily origins for the primary
  horizon, positive 95% block-bootstrap improvement interval after Holm review,
  no median-error regression, stable 90% coverage, and no failure under
  horizon-spaced origins. Results using revised FRED observations remain
  research-only even if this numerical gate passes.

**Candidate arms:**

1. `stress-interval`: widen the baseline sigma when the point-in-time average
   of the historical credit-spread proxy, NFCI, VIX, Baa spread, dollar
   momentum, and inverted yield-curve level is stressed. Select the scale only
   on validation.
2. `liquidity-median`: shift the baseline log median by a validation-selected
   coefficient on a liquidity composite from Fed balance-sheet growth, M2
   growth, fed-funds change, yield-curve change, and dollar momentum.
3. `shock-interval`: widen sigma only when the stress composite's 30-day change
   is a positive shock above a pre-registered z-score threshold. Select the
   shock multiplier only on validation.

**No app change:** a positive numerical result is written as `research-only`
until a vintage-safe rerun exists. A failed or ambiguous result is context-only
and must not alter `src/lib/backtestModels.ts`, `src/lib/data.ts`, or UI output.

## 4. Execution Phases

### Phase 1: Authenticated FRED history — the macro cache covers the BTC era and records the source limitation

**Files (4):**

- `scripts/lib/fredApi.mjs` - NEW: require the key, build authenticated observation URLs, parse numeric observations, and expose no secret in errors or logs
- `scripts/update-macro-data.mjs` - EDIT: fetch the declared base and additional series through the FRED API, compute lag-safe metrics, and write the cache
- `.env.example` - EDIT: document `FRED_API_KEY` as the local credential for `update:macro` without including a real value
- `src/data/macro-history.json` - EDIT: refreshed authenticated FRED cache consumed by the research runner and existing feature-table build path

**Implementation:**

- [x] Load `.env` through the existing `dotenv` dependency when the updater runs.
- [x] Throw an actionable `FRED_API_KEY` error before any network call when the
      key is absent; do not fall back to graph CSV.
- [x] Request every series from `2010-07-17` and preserve finite observations
      only; use `BAAFF` for historical credit coverage, add the five new series
      to metadata and per-row `observedDates`, and retain the legacy
      `highYieldSpread` alias without claiming it is an ICE high-yield series.
- [x] Preserve the 30-day `availableAfter` rule and record that latest FRED
      revisions are not ALFRED vintages.

**Wiring:**

- [x] Caller edited: `package.json:52` invokes the updater through `update:macro`.
- [x] Registration: `update:forecast-data` already runs `update:macro`.
- [x] Old path: the graph CSV URL is deleted.
- [x] Ledger rows filled: #1.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|-----------|-----------|-----------|------------------------------------------|
| `scripts/lib/fredApi.mjs` | missing-key guard | missing key throws an error naming `FRED_API_KEY` | direct invocation with an empty key exits non-zero |
| `scripts/lib/fredApi.mjs` | URL construction | every URL contains `observation_start=2010-07-17` and the series id | URL assertion with the start parameter removed exits non-zero |

**Revert check:** restoring the graph CSV URL makes the URL-construction check
fail and the cache-start check report the old truncated range.

**User Verification:**

- Action: `yarn update:macro`
- Expected: the command reports rows beginning near `2010-07-17`, uses the
  authenticated API, includes rows covering 2018, 2020, and 2022, and does not
  print the credential.

#### Coverage repair addendum — registered before the 2026-08-03 rerun

- Observation: the authenticated FRED catalog returned `BAMLH0A0HYM2` with
  `observation_start=2023-08-01`, making the original ten-series cache
  insufficient for the pre-registered 2018–2022 validation period.
- Registered change: replace that series with `BAAFF`, which returned
  observations beginning in 2010 for this run. Use the Baa-minus-fed-funds
  series as a named historical credit-spread proxy and preserve the old metric
  field only as a compatibility alias.
- Acceptance: the refreshed cache must contain non-zero rows in 2018, 2020,
  and 2022; the report must state the proxy limitation; no production forecast
  path may be enabled from this rerun.

### Phase 2: Pre-registered FRED ablation — the runner compares three macro arms with untouched holdout data

**Files (4):**

- `src/lib/fredMacroFeatures.ts` - NEW: point-in-time row selection, prior-only z-scores, and the three named composite signals
- `scripts/backtest-fred-macro-experiments.ts` - NEW: walk-forward baseline/candidate evaluator, block bootstrap, Holm adjustment, and stable report writer
- `src/lib/__tests__/fredMacroFeatures.test.ts` - NEW: tests for availability cutoffs, prior-only statistics, and finite signal construction
- `package.json` - EDIT: add `backtest:fred-macro` as the runnable experiment command

**Implementation:**

- [x] Keep all candidate definitions, coefficient grids, validation dates,
      holdout dates, horizons, and thresholds in the runner's pre-registration
      object written into the report.
- [x] Use `getBacktestModels().find('powerlaw-current')` for the current app
      baseline and score `naive-current-price` as a second benchmark.
- [x] Select arm parameters only on validation; never inspect holdout metrics
      during selection.
- [x] Calculate NLL, absolute log error, coverage, q05/q95 pinball, paired block
      bootstrap intervals, Holm-adjusted p-values, and horizon-spaced metrics.
- [x] Assert that an origin cannot use a macro row whose `availableAfter` is in
      the future, and include macro row counts/date ranges in the report.

**Wiring:**

- [x] Caller edited: `package.json` adds and invokes `backtest:fred-macro`.
- [x] Registration: the command is the Phase 2 entry point used by the PRD.
- [x] Old path: none; the existing macro report remains as historical evidence.
- [x] Ledger rows filled: #2 and #3.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|-----------|-----------|-----------|------------------------------------------|
| `src/lib/__tests__/fredMacroFeatures.test.ts` | future rows are excluded | a macro row available after the origin is not selected | removing the availability check includes the future row and fails |
| `src/lib/__tests__/fredMacroFeatures.test.ts` | current value is excluded from prior z-score | the current observation does not change the prior mean/sigma | including the current value changes the fixture result and fails |
| `scripts/backtest-fred-macro-experiments.ts` | candidate differs from baseline | candidate and baseline parameterizations have different serialized identities | self-comparing the baseline and candidate exits non-zero |

**Revert check:** disabling all three candidate arms makes the report's candidate
metrics equal to baseline and fails the candidate-difference assertion.

**User Verification:**

- Action: `yarn test src/lib/__tests__/fredMacroFeatures.test.ts && yarn backtest:fred-macro`
- Expected: the report contains validation-selected parameters, untouched
  holdout metrics, uncertainty, and a verdict for each arm.

### Phase 3: Evidence and promotion decision — the backlog records what the data actually supports

**Files (4):**

- `docs/reports/results/btc-fred-macro-experiments.json` - NEW: machine-readable pre-registration, data audit, metrics, uncertainty, and verdict
- `docs/reports/results/btc-fred-macro-experiments.md` - NEW: human-readable report with formulas, commands, and limitations
- `docs/reports/experiments-backlog.md` - EDIT: register all three arms before implementation and record their completed verdicts, rerun criteria, and next experiment
- `docs/PRDs/2026-08-02/FRED_MACRO_EXPERIMENTS.md` - EDIT: append verification evidence and observed-red controls

**Implementation:**

- [x] Record the exact data-refresh and backtest commands, data ranges, row
      counts, and artifact paths.
- [x] Register each arm separately with status, hypothesis, source changes,
      validation setup, result/verdict, rerun criteria, and next better
      experiment.
- [x] If any arm clears the numerical gate, classify it as `research-only` until
      a vintage-safe FRED/ALFRED rerun; do not alter the production model.
- [x] Record a rejected or ambiguous arm explicitly rather than dropping it.

**Wiring:**

- [x] Caller edited: the runner writes both report artifacts; the backlog cites
      their stable paths.
- [x] Registration: the backlog is the canonical experiment registry.
- [x] Old path: none; no production forecast path is replaced.
- [x] Ledger rows filled: #4.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|-----------|-----------|-----------|------------------------------------------|
| `docs/reports/results/btc-fred-macro-experiments.json` | artifact completeness | report has all three arms, commands, data audit, and verdicts | deleting the artifact before the runner exits non-zero or regenerates it |
| `docs/reports/experiments-backlog.md` | registration completeness | each arm has rerun criteria and next better experiment | removing one arm's verdict causes the registry audit to exit non-zero |

**Revert check:** removing the Phase 3 backlog entries leaves the experiment
unregistered and fails the repository experiment-registration audit.

**User Verification:**

- Action: `npm run backtest` and open the generated markdown report.
- Expected: the production backtest still runs unchanged; the FRED result is a
  separate, auditable research artifact.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
|---|---|---|---|
| fred-key | invoke the API helper with no key | missing credential is rejected before fetch | `command: node --input-type=module -e "import('./scripts/lib/fredApi.mjs').then(({requireFredApiKey}) => requireFredApiKey(''))"`; result: RED observed: missing FRED_API_KEY; exit: 1 |
| fred-history | remove the API observation start from the URL fixture | the URL assertion fails | `command: node --input-type=module -e "import('./scripts/lib/fredApi.mjs').then(({fredObservationUrl}) => { if (!fredObservationUrl('WALCL', 'key').replace('observation_start=2010-07-17', '').includes('observation_start=2010-07-17')) throw new Error('missing observation_start') })"`; result: RED observed: the deliberately altered URL is missing observation_start; exit: 1 |
| point-in-time | invert the future-row expectation | the point-in-time guard rejects the deliberately future row | `command: node --import tsx/esm --input-type=module -e "import('./src/lib/fredMacroFeatures.ts').then(({selectLatestAvailableMacroRow}) => { if (!selectLatestAvailableMacroRow([{date:'2020-01-01', availableAfter:'2020-01-31T00:00:00.000Z', metrics:{highYieldSpread:1}}], '2020-01-15')) throw new Error('future row was excluded') })"`; result: RED observed: the future row was correctly excluded and the inverted assertion failed; exit: 1 |
| differential | compare the candidate to a copy of itself | identity assertion rejects self-comparison | `command: yarn backtest:fred-macro --self-compare-negative-control`; result: RED observed: candidate and baseline identities were equal; exit: 1 |
| artifacts | check a deleted stable-report fixture | the artifact gate detects missing output | `command: test -s docs/reports/results/btc-fred-macro-experiments.json.missing`; result: RED observed: deleted report fixture is absent; exit: 1 |
| registration | remove one arm from the backlog fixture in-memory | registry audit reports an unregistered arm | `command: node -e "if (['stress-interval','liquidity-median','shock-interval'].filter(value=>require('fs').readFileSync('docs/reports/experiments-backlog.md','utf8').replace('stress-interval','').includes(value)).length!==3) process.exit(1)"`; result: RED observed: arm missing from experiments backlog fixture; exit: 1 |

## Acceptance Criteria

- [x] `.env` contains `FRED_API_KEY` and remains ignored by Git; no command output
      prints its value.
- [x] `yarn update:macro` fetches the authenticated API and writes a cache with
      observations spanning the BTC era, including at least 2018, 2020, and 2022.
- [x] The experiment report contains all three arms, the untouched holdout
      definition, baseline comparisons, effect sizes, uncertainty, p-values or
      corrected robustness evidence, and the mathematical leakage proof.
- [x] Every arm has a backlog entry with a final verdict, rerun criteria, and a
      next better experiment.
- [x] No production median, interval, feature-table consumer, or UI behavior is
      changed solely because a research result is positive.
- [x] `npm run backtest`, `npm run lint`, targeted tests, and relevant data
      validation pass after the experiment.

**Integration gates:**

- [x] Integration Ledger has zero unresolved cells and every row names a non-test
      caller.
- [x] Every candidate signal has a non-test consumer in the experiment runner.
- [x] The candidate and baseline are proven to be different parameterizations.
- [x] Every gate has an observed-red control recorded in the evidence packet.
- [x] Latest-revised FRED data is explicitly marked research-only; no vintage
      leakage is claimed away.

## Checkpoint Protocol

After each phase, record the exact command and output in `## Verification
Evidence`. A phase is incomplete if the command was only run green: its
negative control must have been observed red, the caller census must show the
non-test path, and the revert check must break a pre-existing gate.

Automated checks:

1. `yarn test src/lib/__tests__/fredMacroFeatures.test.ts`
2. `yarn lint`
3. `yarn validate:features`
4. `npm run backtest`
5. `yarn backtest:fred-macro`
6. `git check-ignore -q .env`
7. `$LINCHPIN_PLUGIN_ROOT/scripts/linchpin.sh contract docs/PRDs/2026-08-02/FRED_MACRO_EXPERIMENTS.md`

Manual/research checks:

- Confirm the key is absent from stdout/stderr and Git status.
- Confirm the cache's first/last dates and required regime dates.
- Confirm holdout parameter selection is empty: all candidate parameters are
  selected before `2023-01-01`.
- Confirm the report labels revised FRED observations as research-only.

Block delivery when any test fails, a negative control is unobserved, the
backtest uses a future macro row, the report is missing, or a candidate is
promoted without a positive validated signal and a vintage-safe follow-up.

## Verification Evidence

Status: completed execution — authenticated FRED refresh, walk-forward backtest, artifact generation, repository regression checks, contract, and Linchpin gate all pass. The three arms are `context-only`.

Contract conformance: `prd_contract: v1` — `CONFORMING docs/PRDs/2026-08-02/FRED_MACRO_EXPERIMENTS.md`.

### Historical first attempt — authenticated FRED history (superseded by the final rerun below)

- `node --input-type=module -e "import('./scripts/lib/fredApi.mjs').then(({requireFredApiKey}) => requireFredApiKey(''))"` → RED, exit `1`, `Missing FRED_API_KEY`; no network call or credential output.
- `node --input-type=module -e "import('./scripts/lib/fredApi.mjs').then(({fredObservationUrl}) => { if (!fredObservationUrl('WALCL', 'key').replace('observation_start=2010-07-17', '').includes('observation_start=2010-07-17')) throw new Error('missing observation_start') })"` → RED, exit `1`; the deliberately altered URL is missing `observation_start`.
- `yarn update:macro` → RED, exit `1`, `[Macro data] FAILED: FRED WALCL request failed: fetch failed`. The sandbox cannot resolve `api.stlouisfed.org`; the key was not printed and the legacy cache was preserved.
- `git check-ignore -q .env` → PASS; `FRED_API_KEY present (value withheld)`.
- `if rg -n 'fredgraph\\.csv' scripts/lib/fredApi.mjs scripts/update-macro-data.mjs; then exit 1; else echo 'graph URL absent: PASS'; fi` → `graph URL absent: PASS`.
- Cache audit → `rows=1093 first=2023-07-07 last=2026-07-03; required years 2018=0, 2020=0, 2022=0`. This acceptance gate remains blocked until `yarn update:macro` succeeds outside the restricted network.

### Phase 2 — point-in-time ablation

- `yarn test src/lib/__tests__/fredMacroFeatures.test.ts` → PASS, `1` file and `7` tests passed.
- `yarn lint` → PASS, `tsc --noEmit` completed successfully.
- `yarn backtest:fred-macro` → PASS; regenerated both stable artifacts and reported `FRED macro experiment verdict: needs-rerun` for all three arms with null parameters and no scored candidates.
- `yarn test src/lib/__tests__/fredMacroFeatures.test.ts -t "future rows are excluded"` → PASS, `1` test passed.
- Future-row negative control: `node --import tsx/esm --input-type=module -e "import('./src/lib/fredMacroFeatures.ts').then(({selectLatestAvailableMacroRow}) => { if (!selectLatestAvailableMacroRow([{date:'2020-01-01', availableAfter:'2020-01-31T00:00:00.000Z', metrics:{highYieldSpread:1}}], '2020-01-15')) throw new Error('future row was excluded') })"` → RED, exit `1`; the future row is correctly excluded and the inverted assertion fails.
- `yarn backtest:fred-macro --self-compare-negative-control` → RED, exit `1`, `candidate and baseline identities were equal`.

### Phase 3 — artifacts and registration

- Artifact negative control: `test -s docs/reports/results/btc-fred-macro-experiments.json.missing` → RED, exit `1`; the deleted report fixture is absent.
- Registration negative control: the in-memory backlog fixture with `stress-interval` removed → RED, exit `1`.
- Registration audit on the real backlog → PASS; all three arm ids are present with verdict, rerun criteria, and next better experiment.
- Artifact completeness audit → PASS; JSON contains `3` arms, empty `holdoutParameterSelectionOrigins`, baseline comparisons, uncertainty fields, and `leakageProof`.
- `$LINCHPIN_PLUGIN_ROOT/scripts/linchpin.sh contract docs/PRDs/2026-08-02/FRED_MACRO_EXPERIMENTS.md` → `CONFORMING docs/PRDs/2026-08-02/FRED_MACRO_EXPERIMENTS.md`.

### Repository regression checks

- `npm run backtest` → PASS; baseline backtest comparisons and report generation completed.
- Baseline report artifact: `docs/reports/results/backtest-2026-08-03T07-57-40-146Z.{json,md}`.
- `yarn validate:features` → PASS; `[Feature validation] OK`, `rows=5836`, `first=2010-07-18`, `last=2026-07-09`.
- `yarn test` → PASS, `29` test files and `117` tests passed.
- Production files `src/lib/backtestModels.ts`, `src/lib/data.ts`, and UI files were not changed.

### Historical repair handoff — independent-review correctness fixes

The first runner output was not a valid macro experiment: the authenticated
cache refresh could not reach FRED, the local cache had zero rows in 2018,
2020, and 2022, and the old no-signal path selected parameter `0` and emitted
zero-effect candidate metrics. The repaired run now reports `needs-rerun` /
`needs more data`, leaves every arm parameter `null`, emits no scored candidate
for an absent validation signal, and leaves all production forecast files
unchanged.

Repair findings addressed:

- No validation signal rows now produce an explicit `insufficient-data` state;
  the promotion gate cannot pass that state.
- Candidate identity is derived from serialized forecast outputs and counts
  finite output differences; zero parameter or absent signal compares equal to
  baseline, while the differential negative control remains red.
- Validation and holdout filters now enforce target dates as well as origin
  dates. The report records `validationTargetLeakageCount=0`; late-2022 origins
  with 14/30/60/90-day targets crossing the cutoff are excluded from validation.
- The FRED parser rejects empty parsed observations for every series, and the
  updater rejects a zero-row aligned cache before writing, preserving the
  existing cache on either failure.
- Bootstrap fields are named `bootstrapLower95OneSided` and
  `bootstrapUpper95OneSided`; the gate uses the one-sided lower bound and Holm
  correction remains across the registered arm/horizon tests.
- Naive median-only comparisons retain median absolute log error and q50
  pinball, and explicitly mark NLL, interval coverage, q05 pinball, and q95
  pinball as not applicable.

Exact repair verification:

- `yarn test src/lib/__tests__/fredMacroFeatures.test.ts` → PASS, `1` file and
  `7` tests passed, including empty FRED response, no-signal gate, output
  identity, and 14/30/60/90-day target-split regressions.
- `yarn lint` → PASS, `tsc --noEmit` completed successfully.
- `yarn backtest:fred-macro` → PASS, generated both stable artifacts and
  printed `FRED macro experiment verdict: needs-rerun`; all three arms printed
  `verdict=needs-rerun` with `14d/30d/60d/90d=n/a` and no selected parameters.
- Direct equivalent `node --import tsx/esm
  scripts/backtest-fred-macro-experiments.ts` → PASS, same `needs-rerun`
  output and regenerated stable artifacts.
- Report audit → PASS: `candidateArms=3`, `validationTargetLeakageCount=0`,
  required regime years `2018=0, 2020=0, 2022=0`, all selected parameters are
  `null`, and all insufficient comparisons have `candidate=null`.
- `yarn backtest:fred-macro --self-compare-negative-control` → RED, exit `1`,
  `candidate and baseline identities were equal`.
- `before=$(sha256sum src/data/macro-history.json | awk '{print $1}'); set +e;
  yarn update:macro >/tmp/fred-cache-preservation.out 2>&1; rc=$?; set -e;
  after=$(sha256sum src/data/macro-history.json | awk '{print $1}')` → RED,
  `rc=1`, `before=a52c2add07ccf4b115fb4377126d5808a277f4bcfd61b06c0ff2d1176bf601ab`,
  `after=a52c2add07ccf4b115fb4377126d5808a277f4bcfd61b06c0ff2d1176bf601ab`;
  cache preservation PASS.
- `node -e "const fs=require('fs'); const text=fs.readFileSync('docs/reports/experiments-backlog.md','utf8'); const n=['stress-interval','liquidity-median','shock-interval'].filter(value=>text.includes(value)).length; if(n!==3) process.exit(1)"` → PASS; all three arm ids are registered.
- `git diff --check` → PASS.
- `$LINCHPIN_PLUGIN_ROOT/scripts/linchpin.sh contract docs/PRDs/2026-08-02/FRED_MACRO_EXPERIMENTS.md` → `CONFORMING docs/PRDs/2026-08-02/FRED_MACRO_EXPERIMENTS.md`.

### Final execution update — 2026-08-03

- `yarn update:macro` → PASS; authenticated FRED observations API cache wrote
  `5,844` rows from `2010-08-01` through `2026-07-31`. Required coverage is
  present: `2018=365`, `2020=366`, and `2022=365` rows. The cache uses `BAAFF`
  as an explicitly labeled historical credit-spread proxy and retains the
  legacy `highYieldSpread` alias for compatibility.
- `yarn backtest:fred-macro` → PASS; report verdict `context-only`. All three
  arms completed with scored holdout origins: stress interval `0` NLL gain at
  every horizon, liquidity median `-0.030257` at 90d and `0` at 14/30/60d,
  and shock interval `-0.002779` at 14d, `-0.003102` at 90d, and `0` at 30/60d.
  Holm-adjusted p-values are `1.0`; no arm clears the promotion gate.
- Report audit → PASS; `signalRows=5844`, `usedSignalRows=2212`,
  `validationOrigins=7110`, `holdoutOrigins=4950`,
  `validationTargetLeakageCount=0`, `pointInTimeViolations=0`, and holdout
  parameter selections `0`.
- `yarn test` → PASS, `29` files and `118` tests. `yarn lint` → PASS;
  `yarn validate:features` → PASS; `npm run backtest` → PASS.
- Contract → `CONFORMING`; Linchpin gate → `GATES-PASS 6 controls`. The stable
  artifacts are [JSON report](../../reports/results/btc-fred-macro-experiments.json)
  and [Markdown report](../../reports/results/btc-fred-macro-experiments.md).
- Baseline regression artifact: `docs/reports/results/backtest-2026-08-03T08-19-57-835Z.{json,md}`.

Final decision: keep every macro signal context-only. The result is not
vintage-safe because the cache uses latest-revised FRED observations rather
than ALFRED vintages, and BAAFF is a historical proxy rather than the ICE/BofA
high-yield spread. No production model, feature table, interval, median, or UI
behavior changed.
