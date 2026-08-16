# PRD: Interval Term Structure and Conformal Calibration

Complexity: 5 -> MEDIUM mode

Score: +2 for 6-10 files across the interval model, config, backtest harness and tests; +2 for a new calibration module; +1 for a rendered product surface (the long-horizon band) changing shape.

Status: Proposed — ships disabled. `INTERVAL_TERM_STRUCTURE_CONFIG.defaultEnabled = false` and `CONFORMAL_CONFIG.defaultEnabled = false` at merge, per `AGENTS.md` forecast safety.

Owner: Forecasting

Depends on: [`../2026-08-02/EVALUATION_INTEGRITY_AND_PROPER_SCORING.md`](../2026-08-02/EVALUATION_INTEGRITY_AND_PROPER_SCORING.md) Phases 1-2. Coordinates with [`../2026-08-02/FAT_TAIL_INTERVAL_DISTRIBUTION.md`](../2026-08-02/FAT_TAIL_INTERVAL_DISTRIBUTION.md) — see §2 "Relationship to P3".

---

## 1. Context

**Problem:** the interval model has three separable degrees of freedom — the daily
scale `sigma_d`, the way that scale is extended across horizons, and the shape of
the distribution it is fed into. Every rejected experiment moved the **scale**.
P3 addresses the **shape**. Nobody has touched the **horizon term structure**, and
it is provably broken.

**Files analyzed:**

- `src/lib/forecastInterval.ts`
- `src/lib/modelConfig.ts:25-46`
- `scripts/calibrate-intervals.ts`
- `src/lib/backtestMetrics.ts`
- `src/lib/pointInTimeForecast.ts`
- `docs/reports/results/backtest-2026-07-13T18-10-43-134Z.md`

**Current behavior:**

```text
sigma_d      = sqrt(0.55·sigma_90^2 + 0.45·sigma_365^2)
sigma_base(H)= sigma_d · sqrt( SUM_{k<H} exp(-2k/210) )
sigma(H)     = m(H) · sigma_base(H)
q_p          = median · exp( sigma(H) · Phi^-1(p) )
```

- The sum `SUM exp(-2k/210)` **converges to ~105.5**, so `sigma_base` saturates at
  `10.3 · sigma_d` no matter how long the horizon is.
- `intervalMultiplierForHorizon` freezes at `0.59` above 365 days
  (`modelConfig.ts:41-44`). Combined with the saturation, **the 10-year band is
  the same width as the 1-year band.** That is a rendered product surface.
- The six `fittedMultipliers` were grid-searched by `calibrate-intervals.ts` to
  minimise `|coverage - target|` over origins from `holdoutStartDate =
  2022-01-01`, then scored on that same window. The coverage table in every
  backtest report is a fitted quantity reported as a validation result.

### Root-cause statement

Two independent defects, both in the horizon dimension:

**(a) The variance term structure is a decay sum, not a scaling law.** The
`exp(-2k/tau)` weighting encodes "shocks mean-revert with tau = 210", which is a
statement about the *median*, reused as a statement about *dispersion*. Empirically
log-return dispersion for BTC grows without bound in H; the model asserts it stops
growing. This is not a tuning question — a saturating function cannot be corrected
by a multiplier table, which is why the six-point table has to bend to 0.59 by
365d to compensate.

**(b) The multiplier table is in-sample and only six points wide.** Coverage at
three nominal levels is the only diagnostic, and it is fitted on the window it is
reported on.

Observed profile, from `backtest-2026-07-13T18-10-43-134Z.md`:

| Horizon | 80% | 90% | 95% |
|---|---|---|---|
| 30d | 79.3% | 89.7% | 94.6% |
| 60d | **79.4%** | 93.1% | **97.9%** |
| 90d | **76.9%** | 90.3% | 95.8% |
| 365d | 78.4% | 91.9% | 96.7% |

Too thin in the middle, too fat at the edges — and the error is not monotone in
horizon (60d over-covers at 95% while 90d under-covers at 80%), which is the
signature of a mis-specified term structure being patched pointwise by six fitted
constants.

### Goals

- Replace the saturating variance term structure with a fitted scaling law, and
  test whether that alone fixes the non-monotone coverage profile.
- Add distribution-free split-conformal calibration of the predictive quantiles as
  an alternative that requires no parametric assumption at all.
- Fix the long-horizon band so it keeps widening past 365 days.

### Non-goals

- **Changing `sigma_d`.** The daily scale is frozen at the current blended
  estimator in every arm. Dynamic volatility, EWMA/HAR, vol-of-vol and asymmetric
  widening are all rejected on the backlog; touching the level would re-run them.
- **Changing the median.** q50 must be bit-identical in every arm. This is a gate,
  not an aspiration.
- Adding features or new data. Implied volatility is [E3](./E3_IMPLIED_VOLATILITY_INTERVAL_INPUT.md).
- Enabling anything at merge.

---

## 2. Solution

Three pre-registered arms, all with q50 held fixed.

**B1 — scaling-law variance.**

```text
sigma(H) = sigma_d · H^alpha
```

`alpha` fitted point-in-time per outer fold from a **frozen** grid
`{0.35, 0.40, 0.45, 0.50, 0.55}` on inner folds only, minimising CRPS. `alpha = 0.5`
is the random-walk value; values below it encode mean reversion in dispersion,
above it encode long-memory. The frozen grid is deliberately coarse — this is a
one-parameter hypothesis test, not a search. Above 365d the same law applies, so
the 10-year band widens correctly by construction.

**B2 — split-conformal quantiles.** For each horizon, take the matured,
**embargoed** point-in-time log errors available strictly before the origin
(P1 D4 makes this set correct for the first time), and use their empirical
quantiles directly:

```text
q_p(H) = median · exp( Q_p( {log(actual/forecast median)} ) )
```

No distributional assumption, no shape parameter, and finite-sample coverage under
exchangeability. Requires a minimum calibration count per horizon
(frozen: `n >= 50`); below that the arm abstains and falls back to `A0`, and the
abstention is reported, never silently filled.

**B3 — conformalized scaling.** B2 applied to standardised errors
`z = log(actual/median) / sigma(H)` with `sigma(H)` from B1. This is the arm most
likely to win: B1 supplies the horizon scaling that empirical quantiles cannot
extrapolate, B2 supplies the shape that B1 cannot express.

### Relationship to P3

P3 tests a **parametric** shape (Student-t with fitted `nu`). B2/B3 test a
**nonparametric** shape. They are answers to the same question and must not be
scored against different baselines or on different origin schedules. Concretely:

- Whichever of P3 / E2 runs second **must** reuse the first one's frozen origin
  schedule, seed, and calibration split, and must report both candidates in one
  comparison table.
- Holm correction is applied across the **combined** family (P3's `nu` arm plus
  E2's B1/B2/B3), not per-PRD. Splitting the family across two documents to get a
  weaker correction is the failure mode this clause exists to prevent.
- If both pass, prefer the one with better CRPS at the shortest promoted horizon;
  ties go to B2/B3 as the assumption-free option.

**Files to change:**

- `src/lib/intervalTermStructure.ts` (new) — `sigma(H)` strategies, `alpha` fitting.
- `src/lib/conformalCalibration.ts` (new) — embargoed calibration sets, empirical quantiles, abstention.
- `src/lib/forecastInterval.ts` — route `sigma(H)` and `quantilePrice` through the strategy; log-normal + decay-sum path stays bit-identical when flags are off.
- `src/lib/modelConfig.ts` — `INTERVAL_TERM_STRUCTURE_CONFIG`, `CONFORMAL_CONFIG`, both `defaultEnabled: false`.
- `scripts/backtest-forecast.ts`, `scripts/calibrate-intervals.ts` — nested outer/inner selection so no multiplier or `alpha` is ever fitted on its own evaluation window.
- Tests for each of the above plus the bit-identity guard.

---

## 3. Phases

### Phase 1 — Freeze and register
Backlog entry with arms, grids, minimum calibration counts, metrics and the §4
gate, committed before any arm runs. Include the combined-family Holm clause.

### Phase 2 — Term structure
Implement B1 behind its flag. Prove the disabled path is bit-identical to today's
output. Extend the band past 365d and capture the rendered before/after.

### Phase 3 — Conformal
Implement B2 and B3 on the embargoed calibration sets from P1 D4. Abstention path
must be exercised by a test.

### Phase 4 — Nested evaluation and verdict
Run all arms plus `A0` on one frozen schedule. Emit
`docs/reports/results/interval-term-structure-<stamp>.{json,md}` with CRPS,
Winkler, PIT histogram, three-level coverage, log-width, width growth in H,
abstention counts, and the combined-family Holm table. Record the verdict.

---

## 4. Gates

Primary metric: **paired CRPS improvement vs `A0`** at the gated horizons
(14/30/60/90) plus 180 and 365 as reported-only.

Secondary: Winkler score at 80/90/95, PIT uniformity (Kolmogorov-Smirnov against
U(0,1)), three-level coverage, mean log-width, and monotonicity of width in H.

Dependence and multiplicity: moving-block bootstrap, block ≥ horizon, 1,000
iterations; Holm across the combined P3+E2 arm family x horizons. The
`rollingOriginSpacingDays = 1` schedule overstates independent evidence by ~90x —
report effective sample size alongside raw `samples` in every table, per P1.

**Promotion gate — all must hold:**

1. ≥ 3% paired CRPS improvement vs `A0` at a promoted horizon, positive bootstrap
   95% lower bound, Holm-adjusted p < 0.05 in the combined family.
2. PIT KS statistic strictly improved versus `A0`, and not rejected at 5%.
3. Coverage within 2 points of nominal at **all three** levels simultaneously at
   the promoted horizon — this is the defect being fixed, so partial credit is a
   fail.
4. Mean log-width inflation ≤ 10% unless it is accompanied by a corrected
   undercoverage that is itself significant.
5. Width strictly increasing in H across 14 → 3,650 days, with no inversions and
   no non-finite values.
6. q50 bit-identical to `A0` at every origin and horizon.
7. `alpha` and calibration-window neighbours stable: the metric at the selected
   grid point is within 25% of its neighbours.

**Negative controls — each observed red before its gate is PASS:**

| Control | Deliberate break | Must produce |
|---|---|---|
| disabled-path identity | flip a flag off, perturb output by 1e-9, assert equality | red |
| q50 invariance | move q50 by 1e-9 in an arm | red |
| leakage | fit `alpha` on the outer window | red — nested-selection assertion fires |
| conformal embargo | remove the embargo from the calibration set | red — overlap assertion fires |
| abstention | force `n < 50` and assert a produced (non-abstained) quantile | red |
| self-compare | score `A0` against `A0` and assert non-zero CRPS delta | red |
| width monotonicity | inject a saturating `sigma(H)` and assert monotone widths | red |

**Regression commands:** `npm run backtest`, `npm run backtest:market`,
`npm run backtest:pit-core`, `npm test -- --run`, `npm run lint`, `npm run build`,
chart E2E and manual visual review of the 1y/10y bands.

---

## 5. Integration Ledger

| Phase | Artifact | Command | Status |
|---|---|---|---|
| 1 | backlog entry | `git show <sha> -- docs/reports/experiments-backlog.md` | TBD |
| 2 | `intervalTermStructure.ts` + identity test | `npx vitest run src/lib/__tests__/intervalTermStructure.test.ts` | TBD |
| 3 | `conformalCalibration.ts` + abstention test | `npx vitest run src/lib/__tests__/conformalCalibration.test.ts` | TBD |
| 4 | results artifact + combined Holm table | `yarn backtest:interval-term-structure` | TBD |

---

## 6. Rerun criteria

Rerun only for a new outer-holdout cohort, a changed median (E1 promoting a
deletion arm changes the errors this calibrates on and **requires** a rerun), or a
distinct pre-registered calibration mechanism. Do not search `alpha` values off
the frozen grid, and do not tune the minimum calibration count, on an already
inspected holdout.

## 7. Next better experiment

If B3 wins, it becomes the baseline that [E3](./E3_IMPLIED_VOLATILITY_INTERVAL_INPUT.md)
is scored against — implied volatility must beat a correctly scaled, correctly
shaped interval, not a mis-specified Gaussian, or the result is uninterpretable.

If all arms fail, the binding constraint is `sigma_d` itself after all, and the
only untried input for it is forward-looking implied volatility. Go straight to E3
and record that the term-structure hypothesis is closed.
