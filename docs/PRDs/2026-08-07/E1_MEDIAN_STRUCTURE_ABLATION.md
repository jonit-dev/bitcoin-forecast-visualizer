# PRD: Median Structure Ablation

Complexity: 3 -> LOW-MEDIUM mode

Score: +1 for 3-5 files confined to the point-in-time harness and its report script; +2 for a new pre-registered candidate family. No runtime forecast file changes in this PRD.

Status: Proposed — report-only. No production median change is authorized by this document under any outcome.

Owner: Forecasting

Depends on: [`../2026-08-02/EVALUATION_INTEGRITY_AND_PROPER_SCORING.md`](../2026-08-02/EVALUATION_INTEGRITY_AND_PROPER_SCORING.md) Phases 1-2 (D3 proper pinball, D4 applied embargo). Running this before P1 would score ablations with the instrument that produced the problem.

---

## 1. Context

**Problem:** The shipped median carries a deterministic structural trend and a
four-year sinusoid. Under the repo's only strict point-in-time benchmark it is
beaten by doing nothing, at every gated horizon. Nobody has established **which
term** is responsible.

**Files analyzed:**

- `src/lib/powerLaw.ts`
- `src/lib/modelConfig.ts:1-23`
- `src/lib/pointInTimeForecast.ts`
- `scripts/backtest-point-in-time-core.ts`
- `docs/reports/results/point-in-time-core-2026-07-10T19-52-43-293Z.md`
- `docs/reports/experiments-backlog.md`

**Current behavior:**

```text
median(t_fut) = B(t_fut) · exp( r_T · exp(-h/tau) ),   tau = 210
B(t)          = a·t^b · (1 + c1·sin(wt) + c2·cos(wt)),  w = 2*pi/1460
r_T           = log(P_now) - log(B(t_now))
```

with `a = 9.48e-10`, `b = 3.6702`, `c1 = 0.2323`, `c2 = 0.4288`
(`modelConfig.ts:16-22`). There is no drift term. Algebraically this is a
log-space blend between the current price and the structural curve:

```text
log median = log B(t_fut) + (log P_now - log B(t_now)) · exp(-h/tau)
```

So the model's entire contribution over the horizon is the **growth ratio**
`B(t_fut)/B(t_now)` plus whatever the sinusoid contributes to it. Everything else
is the current price, decayed.

### Root-cause statement

From `point-in-time-core-2026-07-10T19-52-43-293Z.md` (458 origins, strict
origin-close structural fits, calibration targets strictly before each origin):

| Horizon | Samples | Policy MALE | Naive MALE | Policy is worse by |
|---:|---:|---:|---:|---:|
| 14 | 116 | 0.106246 | 0.104699 | **+1.48%** |
| 30 | 115 | 0.171794 | 0.167511 | **+2.56%** |
| 60 | 114 | 0.260094 | 0.259689 | +0.16% |
| 90 | 113 | 0.332308 | 0.331214 | +0.33% |

`naive-current-price` and `gbm-driftless` produce identical medians and tie.
`ma-trend-20-50-200` and `gbm-recent-drift` are both worse than naive. The loss is
largest at 30d — precisely where `exp(-h/tau)` still leaves ~87% weight on the
current price, meaning a **small** structural contribution is doing **measurable**
damage. That pattern is a testable claim about which term is wrong, and it has
never been tested.

The precedent is strong: `no-future-pivots` — the deletion of an assumption —
produced the largest improvement ever recorded in this repo (365d median error
0.19576 → 0.12978; 365d 90% coverage 68.5% → 91.9%). Twenty-eight experiments have
never promoted an additive signal.

### Goals

- Determine which structural term of the median is responsible for the
  point-in-time loss to naive, at a frozen `tau = 210`.
- Produce one artifact that either (a) identifies a deletion worth freezing into
  the prospective ledger, or (b) records that no single-term deletion recovers the
  gap, which redirects effort to E2/E3 permanently.

### Non-goals

- **This is not a tau search and must not become one.** `tau` stays frozen at 210
  in every arm. The backlog blocks 60/90/120/150/300/420, volatility-conditional
  tau, and expanding-window AR(1) adaptive tau. Any result that would be obtained
  by varying `tau` is out of scope and must be reported as out of scope, not as a
  finding. A reviewer should reject this experiment if any arm alters `tau`.
- No refit, shrinkage, or re-estimation of `a, b, c1, c2` beyond the harness's
  existing expanding point-in-time fit. That is YL-1, already rejected at
  Holm p = 1.0.
- No new features, no new data sources, no interval changes.
- No production change. Even a passing arm goes to the E4 ledger, not to `data.ts`.

---

## 2. Solution

**Approach:** add a `median-structure-ablation` candidate family to
`src/lib/pointInTimeForecast.ts`, scored on the existing 458-origin schedule
against the same five benchmarks. Each arm changes exactly one term and is frozen
before any outcome is inspected.

| Arm | Definition | Question it answers |
|---|---|---|
| `A0` | Shipped policy (unchanged) | baseline |
| `A1` | `B(t_fut)/B(t_now) := 1` — no structural growth over the horizon, mean reversion retained toward the origin-anchored curve | Does the deterministic trend growth term help? |
| `A2` | `c1 = c2 = 0` — pure `a·t^b`, no four-year sinusoid | Is the cycle term the damage? |
| `A3` | `exp(-h/tau) := 1` — full deletion of the structural pull; identically naive | Boundary control; must reproduce `naive-current-price` to 1e-12 |
| `A4` | `A1` and `A2` combined | Is the residual structure additive? |

`A3` is a **correctness control, not a candidate**. If `A3` does not reproduce the
`naive-current-price` benchmark exactly, the harness wiring is wrong and no other
arm's number may be read.

**Why term ablation rather than a fitted blend weight:** a free blend weight in
`log median = w·log P_now + (1-w)·log B` is algebraically `w = exp(-h/tau)`, i.e.
a tau reparametrisation, which the backlog blocks. Term ablation at frozen tau is
a genuinely different question and is unsearched.

**Files to change:**

- `src/lib/pointInTimeForecast.ts` — extend `PitCandidateId`, add the arm builders.
- `scripts/backtest-point-in-time-core.ts` — accept `--candidate median-structure-ablation --arm A1..A4`; extend the frozen-specification block.
- `src/lib/__tests__/pointInTimeForecast.test.ts` — arm identity and control tests.
- `package.json` — `backtest:median-ablation`.
- `docs/reports/experiments-backlog.md` — the pre-registered entry (before implementation).

---

## 3. Phases

### Phase 1 — Freeze and register

Write the backlog entry containing the arm table above, the metrics, the gate in
§4, and the stopping rule. Commit it **before** any arm runs. No outcome may be
inspected until this commit exists.

### Phase 2 — Harness

Implement arms behind `--arm`. Add the `A3 ≡ naive` identity test and an `A0 ≡
current output` bit-identity test. Both must fail when deliberately broken
(see §4 negative controls).

### Phase 3 — Run

`yarn backtest:median-ablation --arm A0..A4` on the full 458-origin schedule with
`PIT_SEED` unchanged. Emit `docs/reports/results/median-structure-ablation-<stamp>.{json,md}`
with per-origin provenance, data hashes, and the deterministic content hash
already produced by the core script.

### Phase 4 — Verdict and registration

Update the backlog entry with the verdict whichever way it goes. If an arm passes
§4, hand it to [E4](./E4_PROSPECTIVE_LEDGER_ACTIVATION.md) as a freeze candidate.
If no arm passes, record the negative result and state explicitly that median
structure is closed as a research direction until a new data cohort exists.

---

## 4. Gates

Primary metric: **paired mean absolute log-error improvement vs `A0`**, on the
identical origin/horizon schedule.

Secondary: median absolute log error, bias, direction hit rate, and — once P1
lands — CRPS, Winkler and PIT uniformity of the corresponding predictive
distribution with the interval model held fixed.

Dependence and multiplicity: moving-block bootstrap with block length
`max(horizon, origin spacing)`, 1,000 iterations, Holm correction across
**four arms x four horizons = 16 comparisons**. This is a wider family than any
prior PIT candidate; the correction must reflect that, not the 4-horizon family
used for YL-1/YL-2.

**Promotion gate — all must hold for a promoted horizon:**

1. ≥ 2.0% relative MALE improvement vs `A0` at that horizon.
2. Holm-adjusted p < 0.05 across the full 16-comparison family, with a positive
   bootstrap 95% lower bound.
3. No worse than 0.5% MALE regression at any other gated horizon.
4. The arm also beats `naive-current-price` at that horizon. An arm that merely
   loses to naive less than `A0` does is a diagnosis, not a promotion.
5. Sign stability: paired improvement ≥ 0 in every regime bucket with ≥ 5 samples.
6. Interval calibration unchanged or better — coverage loss ≤ 2 points at
   80/90/95, no material CRPS/Winkler regression.

**Negative controls — each must be observed red before its gate is recorded PASS:**

| Control | Command shape | Must produce |
|---|---|---|
| `A3` identity | run `--arm A3`, assert MALE ≠ naive MALE | red |
| `A0` bit-identity | perturb `A0` by 1e-9 and assert equality with shipped output | red |
| tau immutability | assert `POWER_LAW_MEAN_REVERSION_TAU_DAYS === 210` at every arm build; mutate to 209 | red |
| self-compare | run `A0` against `A0`; assert non-zero improvement | red |
| registration | assert all five arm ids appear in the backlog before results are written | red |
| leakage | assert `pointInTimeViolations === 0` and embargo applied (P1 D4) | red when embargo removed |

**Regression commands before any downstream use:** `npm run backtest`,
`npm run backtest:pit-core`, `npm test -- --run`, `npm run lint`, `npm run build`.

---

## 5. Integration Ledger

| Phase | Artifact | Command | Status |
|---|---|---|---|
| 1 | backlog entry | `git show <sha> -- docs/reports/experiments-backlog.md` | TBD |
| 2 | harness + tests | `npx vitest run src/lib/__tests__/pointInTimeForecast.test.ts` | TBD |
| 3 | results artifact | `yarn backtest:median-ablation --arm A0..A4` | TBD |
| 4 | verdict in backlog | manual | TBD |

---

## 6. Rerun criteria

Rerun only for: a materially extended origin cohort (≥ 60 new non-overlapping 90d
outcomes), a change to the structural fit procedure itself, or a distinct
pre-registered term decomposition. **Do not** rerun with adjusted tau, adjusted
sinusoid period, or refitted coefficients on an already-inspected cohort — those
are the blocked families.

## 7. Next better experiment

If a deletion arm wins: freeze it in the E4 ledger and re-run E2 on top of it,
since the interval model calibrates from this median's errors and the whole
interval term structure shifts underneath a changed centre.

If no arm wins: the median is at the noise floor at 60-90d
(MALE ≈ 0.26-0.33 means ±30-39% multiplicative error, which no term of a
deterministic curve will move). Redirect entirely to distribution work — E2, P3,
E3 — and record that in the backlog so it is not re-proposed.
