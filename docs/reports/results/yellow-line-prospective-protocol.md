# Yellow-Line Prospective Confirmation Protocol

Status: **needs more data**
Protocol version: `yellow-line-prospective-v1`
Frozen on: 2026-07-10
Candidate/config hash: **none selected**
Prospective start: **not started**

No YL-1 or YL-2 candidate has passed the prerequisite development gate, so the ledger is intentionally empty. This document does not claim prospective evidence and does not authorize a runtime change.

## Frozen rules

1. Before the first origin is recorded, select at most one candidate/config hash per horizon. Once any row exists, neither that selection nor an existing row may change.
2. Only `YL-1` or `YL-2` may be frozen. Record positive baseline and candidate forecasts, origin, target, horizon, candidate ID, config hash, and recording timestamp no later than the origin and before the target close exists. Candidate freeze time must precede every origin and recording timestamp.
3. Score a row only when its target date is at or before the latest checked-in BTC close. Missing target closes remain unscored.
4. No outcome-driven candidate, parameter, metric, threshold, or stopping-rule change is permitted between review dates. No interim result authorizes promotion.
5. Final review requires at least 30 nominal non-overlapping matured outcomes at the longest proposed promotion horizon. Greedy chronological counting requires consecutive counted origins to be separated by at least that horizon. Shorter-horizon evidence cannot authorize a longer horizon.
6. At final review, apply the PRD's frozen effect-size, dependence-aware uncertainty, Holm multiplicity, calibration, robustness, and release-backtest gates. Reaching the sample count only changes status to `ready for final review`; it is not a pass.
7. The ledger binds this exact protocol content and its frozen schema by SHA-256. Each row commits to its complete prediction payload and the previous row hash, beginning at a protocol/schema-derived genesis hash. The evaluator verifies this chain. This detects edits to the persisted file but cannot prove that an attacker did not replace the protocol and ledger together; durable external publication or source-control history remains required for stronger append-only evidence.
8. Comparative candidate/baseline scores are suppressed until the stopping rule is reached. Operational output exposes only integrity, maturity, and pending-count status.

## Review schedule

Operational checks may verify ledger integrity and report pending sample count at any time without inspecting candidate ranking for tuning. Outcome review occurs only once the longest-horizon stopping rule is reached. A safety or data-integrity failure may terminate the study as rejected, but cannot change the candidate or thresholds.

## Reproduction

Run `npm run evaluate:prospective-forecast`. Until a candidate is frozen and genuine forward predictions mature, the expected verdict is `needs more data` with 30 pending non-overlapping outcomes.
