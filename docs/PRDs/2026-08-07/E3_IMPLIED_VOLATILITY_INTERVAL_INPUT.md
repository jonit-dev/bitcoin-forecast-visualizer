# PRD: Implied Volatility as an Interval Input

Complexity: 5 -> MEDIUM mode

Score: +2 for a new external data source with its own updater, validator and freshness contract; +2 for 6-10 files; +1 for the availability/vintage audit the promotion gate depends on.

Status: Proposed — report-only. `IMPLIED_VOL_CONFIG.defaultEnabled = false` at merge.

Owner: Forecasting

Depends on:
- [`../2026-08-02/EVALUATION_INTEGRITY_AND_PROPER_SCORING.md`](../2026-08-02/EVALUATION_INTEGRITY_AND_PROPER_SCORING.md) — the gate is stated in CRPS/Winkler/PIT.
- [`../2026-08-02/DATA_HISTORY_RECOVERY_AND_VINTAGE_ARCHIVE.md`](../2026-08-02/DATA_HISTORY_RECOVERY_AND_VINTAGE_ARCHIVE.md) Phase 1 — this source must not repeat D1/D2 (wholesale rewrite, truncated history, no vintages).
- [`./E2_INTERVAL_TERM_STRUCTURE_AND_CONFORMAL.md`](./E2_INTERVAL_TERM_STRUCTURE_AND_CONFORMAL.md) — supplies the baseline. Scoring implied vol against a mis-specified Gaussian would be uninterpretable.

---

## 1. Context

**Problem:** the interval model estimates tomorrow's dispersion entirely from
yesterday's returns. A liquid, public, forward-looking estimate of exactly that
quantity exists and has never been ingested.

**Files analyzed:**

- `src/lib/forecastInterval.ts:163-174` (`powerLawResidualVariance`), `:211` / `:290` (`computeLogReturnStats` vs `sampleStandardDeviation`)
- `src/lib/modelConfig.ts:25-46`
- `scripts/update-derivatives-data.mjs` (the D2 anti-pattern to avoid)
- `scripts/check-data-freshness.ts`
- `docs/reports/data-sources.md`
- `docs/reports/experiments-backlog.md` — the rejected feature families

**Current behavior:** `sigma_d = sqrt(0.55·sigma_90^2 + 0.45·sigma_365^2)`, a blend
of two trailing realised-volatility windows. Realised volatility is a
backward-looking estimator of a quantity that is known to be forecastable from
option prices; the variance-risk-premium literature is unusually consistent on
this, and it is the one input class this repo has never touched.

### Root-cause statement

Of 28 registered experiments, **every** feature experiment targeted the median via
`median x exp(coef x feature)` and was rejected — ETF flow, funding and premium,
stablecoin supply, Fear & Greed, on-chain interaction states, macro regimes,
technical indicators. That is a consistent, informative negative result: BTC's
conditional mean at 14-90d is close to a martingale, and no amount of feature
engineering has moved it.

The conditional *variance* is a different object with different statistical
properties, and the repo has only ever estimated it from its own history. Deribit
publishes DVOL (a 30-day forward implied volatility index for BTC) plus ATM
implied volatility by expiry and 25-delta risk reversal, through a public,
keyless endpoint, with history beginning in 2021. This is the only remaining
untried input class, and it points at the only quantity still worth improving.

### Goals

- Ingest Deribit implied volatility with a correct availability contract and an
  append-only cache, and validate it.
- Test, under pre-registration, whether implied volatility improves the predictive
  distribution when substituted for or blended with realised volatility.
- Produce a defensible negative result if it does not.

### Non-goals

- **Any median adjustment whatsoever.** Risk reversal as a directional signal is
  a `median x exp(coef x feature)` construction and is blocked by existing rerun
  criteria; it would be re-rejected. q50 bit-identity is a gate.
- Changing the term structure or the distribution shape — those are E2 and P3, and
  this experiment holds them fixed at whatever E2/P3 settled on.
- Options-implied full risk-neutral densities. Out of scope; the sample does not
  support it.

---

## 2. Solution

**Data.** New `scripts/update-implied-vol-data.mjs` writing
`src/data/implied-vol-history.json`, plus `scripts/validate-implied-vol-data.mjs`
and a `check-data-freshness.ts` entry.

Source: Deribit public `get_volatility_index_data` (DVOL, BTC, daily resolution)
plus ATM IV by expiry bucket where available. Keyless.

Non-negotiable contract, written to avoid the D1/D2 failures:

| Requirement | Why |
|---|---|
| Append-only merge; never `writeFileSync` the whole cache from a bounded lookback | D2 left open interest on 28 of 5,836 rows |
| Explicit `observation_start` in the request; assert the returned first date matches the requested one | D1 silently truncated 16 years of macro to 3 |
| `availableAfter` = the UTC day's close + a conservative publication lag, recorded per row | matches the `reportDate + 4d` discipline that made COT the best-behaved source here |
| Store `(series, as_of_date, observed_at, value)` so revisions are visible | P2's vintage contract |
| Validator asserts row count, date continuity, no forward-filled duplicates, and no future `availableAfter` | freshness checks currently pass a row carrying 57/72 features (D5) |

**Sample-size reality, stated before any result is seen.** DVOL history begins in
2021. At 90d, non-overlapping outcomes accumulate at ~4/year, so ~5 years yields
roughly 20 — **below the 30 required by the standing promotion rule**. Therefore:

- 14d and 30d are the only horizons eligible for promotion from this experiment.
- 60d and 90d are **development-signal-only** regardless of what they show, and
  must be labelled as such in the artifact.
- The Phase 1 audit records the exact first available date; if it is later than
  2021-06-30, even 30d drops to development-only. This threshold is frozen now,
  before the audit runs.

**Arms (frozen):**

| Arm | Definition |
|---|---|
| `C0` | Baseline: whatever E2/P3 promoted, or the current model if neither did |
| `C1` | `sigma_d := DVOL / sqrt(365)`, direct substitution |
| `C2` | `sigma_d := lambda·IV + (1-lambda)·RV`, `lambda` from the frozen grid `{0.25, 0.5, 0.75}`, fitted on inner folds only |
| `C3` | Horizon-aware: use the ATM IV term structure slope to scale `sigma(H)`, holding E2's `alpha` fixed |

`C3` runs only if the Phase 1 audit finds usable multi-expiry IV with the same
availability guarantees; otherwise it is dropped and its omission is recorded.

**Files to change:** the two scripts above, `src/data/implied-vol-history.json`,
`src/lib/impliedVolatility.ts` (point-in-time selection, mirroring
`selectLatestAvailableMacroRow` in `fredMacroFeatures.ts`),
`src/lib/forecastInterval.ts` (strategy hook only), `src/lib/modelConfig.ts`,
`scripts/backtest-implied-vol.ts`, `scripts/check-data-freshness.ts`,
`package.json`, tests.

---

## 3. Phases

### Phase 1 — Source audit and register
Fetch, record the exact first available date, publication lag, gaps, and any
restatement behaviour. Write the backlog entry with arms, grids, the horizon
eligibility rule above, and the §4 gate. Commit before any arm runs. **If the
audit fails the availability contract, stop here and record the failure** —
that is a complete, useful outcome.

### Phase 2 — Ingest and validate
Updater, validator, freshness entry, point-in-time selection with a test that a
row with `availableAfter` in the future is excluded.

### Phase 3 — Ablation
Run `C0..C3` on the frozen schedule shared with E2, restricted to the DVOL era.
Also re-run `C0` on the full history to quantify how much of any difference is the
shortened sample rather than the signal.

### Phase 4 — Verdict
Emit `docs/reports/results/btc-implied-volatility-<stamp>.{json,md}` and update the
backlog with the verdict either way.

---

## 4. Gates

Primary metric: **paired CRPS improvement vs `C0`** at 14d and 30d.

Secondary: Winkler at 80/90/95, PIT KS, three-level coverage, mean log-width,
and the same metrics at 60/90d marked development-only.

Dependence and multiplicity: moving-block bootstrap, block ≥ horizon; Holm across
`{C1, C2, C3} x {14, 30}` = up to 6 comparisons. Effective sample size reported
alongside raw counts.

**Promotion gate — all must hold:**

1. ≥ 3% paired CRPS improvement at a promoted horizon (14d or 30d only).
2. Holm-adjusted p < 0.05, positive bootstrap 95% lower bound.
3. ≥ 30 nominal non-overlapping matured outcomes at that horizon within the DVOL
   era. Counted greedily and chronologically, reported explicitly.
4. Coverage within 2 points of nominal at all three levels; PIT KS not rejected.
5. q50 bit-identical to `C0` at every origin and horizon.
6. `lambda` neighbours stable within 25%.
7. The same arm does not regress 60/90d CRPS by more than 0.5%, even though those
   horizons cannot themselves promote.
8. A documented fallback exists and is tested for every day the source is missing
   or stale — a forecast must never silently degrade because an exchange endpoint
   was down.

**Negative controls — observed red before PASS:**

| Control | Deliberate break | Must produce |
|---|---|---|
| history completeness | strip `observation_start` from the request | red |
| append-only | run the updater twice and assert row count never decreases; then force a wholesale write | red |
| point-in-time | assert a future-`availableAfter` row is selected | red |
| q50 invariance | perturb q50 by 1e-9 | red |
| self-compare | `C0` vs `C0`, assert non-zero CRPS delta | red |
| horizon eligibility | attempt to promote a 90d result and assert the gate blocks it | red |
| stale-source fallback | delete the latest N rows and assert the forecast still produces a valid, labelled interval | red |
| registration | assert all arm ids appear in the backlog before results are written | red |

**Regression commands:** `npm run backtest`, `npm run backtest:pit-core`,
`npm run validate:data`, `npm run check:freshness`, `npm test -- --run`,
`npm run lint`, `npm run build`.

---

## 5. Integration Ledger

| Phase | Artifact | Command | Status |
|---|---|---|---|
| 1 | source audit + backlog entry | `node scripts/update-implied-vol-data.mjs --audit-only` | TBD |
| 2 | cache + validator + freshness | `yarn validate:implied-vol && yarn check:freshness` | TBD |
| 3 | ablation artifact | `yarn backtest:implied-vol` | TBD |
| 4 | verdict in backlog | manual | TBD |

---

## 6. Rerun criteria

Rerun when the DVOL era has accumulated ≥ 30 additional non-overlapping outcomes
at a horizon that was development-only, when the baseline changes (E2/P3
promotion), or for a distinct pre-registered IV construction. Do not re-search
`lambda` on an inspected holdout, and do not appeal a rejection by adding expiry
buckets after seeing results.

## 7. Next better experiment

If implied volatility wins at 14/30d, the natural follow-up is the variance risk
premium (`IV - RV`) as a **regime label** for the conformal calibration set in E2 —
calibrating on the subset of history whose VRP regime matches the origin. That
uses IV without ever putting it in the median, and it is the only construction
that could extend the benefit to 60/90d without waiting years for sample.

If it loses, the interval scale is as good as trailing returns can make it, and
the remaining work is entirely shape and term structure. Record that and close the
input-class question.
