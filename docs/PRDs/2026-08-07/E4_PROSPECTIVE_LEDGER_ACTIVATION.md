# PRD: Prospective Ledger Activation

Complexity: 4 -> MEDIUM mode

Score: +2 for 6-10 files across the ledger, protocol, evaluator, worker and tests; +1 for a protocol version bump that changes an integrity contract; +1 for a scheduled production job.

Status: Proposed. Ships enabled — but it records, it does not forecast. No production forecast behaviour changes in this PRD.

Owner: Forecasting

Depends on: at least one development signal from [E1](./E1_MEDIAN_STRUCTURE_ABLATION.md), [E2](./E2_INTERVAL_TERM_STRUCTURE_AND_CONFORMAL.md) or [P3](../2026-08-02/FAT_TAIL_INTERVAL_DISTRIBUTION.md). Phases 1-3 can be built in parallel with those; Phase 4 cannot start until a candidate exists to freeze.

---

## 1. Context

**Problem:** this repo cannot promote anything. Not "has not" — *cannot*, under
its own rules, for years.

**Files analyzed:**

- `src/data/prospective-forecast-ledger.json`
- `docs/reports/results/yellow-line-prospective-protocol.md`
- `scripts/evaluate-prospective-forecast.ts`
- `workers/market-quote-refresh/`
- `docs/reports/experiments-backlog.md`
- `AGENTS.md`

**Current behavior:** the ledger is hash-bound and empty —
`frozenCandidates: []`, `rows: []` — and has been since 2026-07-10. The protocol
(`yellow-line-prospective-v1`) states:

- Rule 2: **only `YL-1` or `YL-2` may be frozen.** Both were rejected at
  Holm p = 1.0. The protocol is therefore closed to every candidate that could
  plausibly be produced next.
- Rule 5: promotion requires **≥ 30 nominal non-overlapping matured outcomes at
  the longest proposed promotion horizon**, counted greedily with consecutive
  origins separated by at least that horizon.
- Rule 5 also states shorter-horizon evidence cannot authorise a longer horizon —
  correct — but the protocol offers no path to promote a shorter horizon on its
  own evidence.

### Root-cause statement

Do the arithmetic implied by Rule 5:

| Promotion horizon | Non-overlapping outcomes per year | Calendar time to 30 |
|---:|---:|---|
| 14d | ~26 | **~14 months** |
| 30d | ~12 | ~2.5 years |
| 60d | ~6 | ~5 years |
| 90d | ~4 | **~7.4 years** |

Nothing has been recorded, so the clock reads zero on all four rows. Every
experiment in this bundle ends the same way — "development signal, prospective
confirmation required" — into a ledger that accepts no candidate and, if it did,
would answer in 2033.

This is the binding constraint on the stated goal. A better model that can never
ship is worth the same as no better model. The two fixes are independent and both
cheap:

1. **Open the protocol** to any candidate registered in the backlog, not just
   YL-1/YL-2.
2. **Allow per-horizon promotion**, so a 14d improvement can promote in ~14 months
   on 14d evidence while 90d keeps accumulating. This is not a weakening: Rule 5
   already forbids short evidence authorising long horizons. Making the converse
   explicit costs no rigour and recovers six years.

And one more, which is the real reason nothing was ever recorded: **recording is
manual.** There is no job that appends a row per day. Phase 3 fixes that.

### Goals

- Ship `yellow-line-prospective-v2`: open candidate registry, per-horizon
  promotion, unchanged integrity guarantees.
- Automate daily append so the ledger fills without anyone remembering.
- Freeze the first real candidate and start the clock.

### Non-goals

- **Weakening any statistical gate.** Effect sizes, Holm correction, coverage
  tolerances, the 30-outcome count, the non-overlap rule, and the
  no-outcome-driven-change rule are all carried over verbatim.
- Exposing interim candidate rankings. Rule 8's suppression stays: operational
  output reports integrity, maturity and pending counts only.
- Any change to what the app forecasts or displays.

---

## 2. Solution

**Protocol v2 — the exact diff from v1:**

| Rule | v1 | v2 |
|---|---|---|
| 2 | only `YL-1` / `YL-2` may be frozen | any candidate with a backlog entry predating the freeze, identified by candidate id + config hash + backlog commit sha |
| 5 | 30 non-overlapping outcomes at the **longest** proposed horizon | 30 non-overlapping outcomes **at each horizon, independently**; a horizon promotes on its own evidence; longer horizons remain pending |
| 6 | one final review | per-horizon review, each firing exactly once when that horizon's count is reached |
| 9 (new) | — | daily automated append; a missed day is recorded as a gap, never backfilled |
| 10 (new) | — | pre-registered safety stop: if a frozen candidate produces a non-finite value, an inverted interval, or a coverage collapse below 50% of nominal over 30 consecutive matured rows, the study terminates as `rejected` and the reason is recorded |

Everything else — hash chaining to the previous row, protocol and schema SHA-256
binding, the append-only guarantee, no outcome-driven parameter changes,
suppression of interim comparisons — is preserved byte-for-byte in intent.

**Migration:** v1's ledger is empty, so there is nothing to migrate. v2 gets a new
genesis hash derived from the v2 protocol and schema. The v1 protocol document is
retained unmodified for provenance, marked superseded.

**Automation:** extend the existing Cloudflare Worker pattern
(`workers/market-quote-refresh`, cron at 23:15 UTC) with a
`prospective-ledger-append` job that runs after the market-quote refresh:

- reads the frozen candidates, computes baseline and candidate forecasts at the
  origin, appends one row per candidate x horizon,
- writes the row hash chain,
- records a gap marker if the market-quote refresh did not produce a close,
- never scores, never compares, never reports a ranking.

Git history is the durable external anchor the v1 protocol asks for (§7 "durable
external publication"): each append is a commit, so the chain is witnessed outside
the file itself.

**Files to change:**

- `docs/reports/results/prospective-protocol-v2.md` (new)
- `src/data/prospective-forecast-ledger.json` — v2 genesis, still empty at merge
- `src/lib/prospectiveLedger.ts` — v2 schema, per-horizon maturity, safety stop
- `scripts/evaluate-prospective-forecast.ts` — per-horizon status
- `workers/prospective-ledger-append/` (new)
- `src/lib/__tests__/prospectiveLedger.test.ts`
- `docs/reports/experiments-backlog.md`

---

## 3. Phases

### Phase 1 — Protocol v2
Write and hash the v2 document. Register in the backlog. No code yet.

### Phase 2 — Ledger and evaluator
Implement the v2 schema, per-horizon maturity counting, the safety stop, and the
hash chain. Tests must cover: greedy non-overlap counting, a tampered row failing
verification, a gap row, and the safety stop firing.

### Phase 3 — Automated append
Deploy the worker to preview first. Invoke a scheduled event twice and confirm
idempotency — a second run on the same origin must not append a duplicate row.
Only then enable production cron.

### Phase 4 — Freeze the first candidate
When E1, E2 or P3 produces a development signal, freeze exactly one candidate per
horizon, record the candidate id, config hash, backlog commit sha and freeze
timestamp, and start recording. **The freeze timestamp must precede every origin.**

If none of them produces a signal, freeze the strongest *baseline-equivalent*
candidate anyway — the current policy against `naive-current-price` — so the
clock starts and the harness is proven in production. An empty ledger has never
told anyone anything.

---

## 4. Gates

This PRD ships process, not a forecast, so the gate is integrity rather than
accuracy.

**Acceptance — all must hold:**

1. Hash chain verifies from genesis; a single-byte edit anywhere fails verification.
2. Appends are idempotent per origin; two runs on one origin produce one row.
3. Non-overlap counting is correct at all four horizons against a hand-checked
   fixture.
4. Per-horizon status is independent: a 14d count reaching 30 does not change 90d
   status, and 14d review firing does not authorise 90d.
5. No comparative score is emitted before a horizon's stopping rule is reached —
   asserted by a test that greps the operational output for candidate metrics.
6. Freeze timestamps precede every origin and every recording timestamp.
7. The safety stop fires on a synthetic non-finite candidate and terminates the
   study as `rejected`.
8. Missed days appear as gap rows; backfill attempts are rejected.

**Negative controls — observed red before PASS:**

| Control | Deliberate break | Must produce |
|---|---|---|
| chain integrity | flip one byte in a recorded row | red |
| idempotency | run the same origin twice and assert two rows | red |
| non-overlap | count overlapping origins as independent | red |
| horizon independence | authorise 90d from 14d evidence | red |
| suppression | emit a candidate/baseline delta before the stopping rule | red |
| freeze ordering | record an origin earlier than the freeze timestamp | red |
| backfill | append a row for a past gap date | red |
| safety stop | inject a non-finite candidate value | red |

**Regression commands:** `yarn evaluate:prospective-forecast`,
`npx vitest run src/lib/__tests__/prospectiveLedger.test.ts`, `npm run lint`,
`npm run build`, plus the preview-then-production worker deploy sequence already
documented in `README.md` for `market-quote-refresh`.

---

## 5. Integration Ledger

| Phase | Artifact | Command | Status |
|---|---|---|---|
| 1 | `prospective-protocol-v2.md` + backlog entry | `git show <sha>` | TBD |
| 2 | v2 ledger + evaluator + tests | `npx vitest run src/lib/__tests__/prospectiveLedger.test.ts` | TBD |
| 3 | worker on preview, then production | `wrangler deploy --env preview` then two scheduled invocations | TBD |
| 4 | first frozen candidate | `yarn evaluate:prospective-forecast` reports `pending`, not `not started` | TBD |

---

## 6. Rerun criteria

The protocol itself is not rerun — it is versioned. Any future change requires a
v3 document, a new genesis, and abandonment of in-flight studies; it may never be
applied to a ledger that already has rows. That constraint is the point of the
document.

## 7. Next better experiment

Once rows accumulate, the ledger becomes the repo's first honest measurement of
its own forecast in production, and the natural follow-up is a public reliability
page driven by matured prospective rows rather than by backtests — the one number
a user of a forecasting product should actually see.

The 14d horizon reaches its stopping rule in roughly 14 months from the first
frozen candidate. That is the earliest any accuracy work in this bundle can reach
production. Every week the freeze is delayed moves that date by a week, which is
the strongest argument for running Phase 4 with a baseline-equivalent candidate
rather than waiting for a winner.
