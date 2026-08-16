# S&P 500 Crisis Challenger v2 — imported context report

**Date:** 2026-08-15
**Contract conformance:** `prd_contract: v1`
**Source archive:** `sp500-crisis-model-v2.zip` (supplied archive; not bundled)
**Runtime verdict:** `shadow` / `context-only` / `not-promoted`

## Scope and provenance

This artifact records the browser-safe outputs of the supplied S&P 500 Crisis
Challenger v2 archive. The challenger maps an existing base classifier's raw
probability; it is not the 23-feature base classifier and it is not recomputed
from VOO prices. The application ships the typed JSON snapshot only. It does
not ship or execute the Python/joblib mapper.

- Archive/report date: **2026-08-15**
- Current score as-of date: **2026-08-14**
- OOS history: **1,025 weekly observations**, `2000-01-07` → `2025-12-26`
- Target: **cross 15% below the recent 252-session high within 63 trading days**
- Locked comparison: **2016–2025**, 438 rows and 43 positives
- Selection: 126 candidates, expanding 2006–2015 forward validation, 100-calendar-day embargo, primary Brier-score selection

The existing S&P 500 tab remains the generic VOO price forecast. The additive
Crisis tab reuses its quote and forecast controls, but the challenger score
never enters `buildMarketForecast`, `ForecastSummary`, `probabilityForecast`,
or any other asset output.

## Current imported score

| Field | Value |
|---|---:|
| Base raw probability | 34.9637% |
| Incumbent probability | 4.8346% |
| Challenger evaluation probability | 2.6165% |
| Challenger deployment probability | 3.5133% |
| Deployment WATCH threshold | 10.6855% |
| Deployment HIGH threshold | 23.9388% |
| Operational zone | `NORMAL` |
| Score as of | 2026-08-14 |

Probability levels are model-dependent and are not directly interchangeable.
The lower v2 number is not independent evidence that the market is safer.
The live surface labels the score imported and shadow/context-only. If the
active VOO quote date is later than 2026-08-14, it shows an explicit stale
warning and does not extrapolate the score.

## Locked 2016–2025 comparison

| Metric | Incumbent | Challenger v2 | Change |
|---|---:|---:|---:|
| Average precision | 0.225161 | **0.248045** | +0.022884 |
| ROC AUC | 0.658993 | **0.660583** | +0.001590 |
| Brier score | 0.084333 | **0.082754** | −0.001580 |
| Log loss | 0.310601 | **0.303813** | −0.006788 |

Both models issued a frozen HIGH warning before 3 of 4 distinct holdout
crossings. Both missed the abrupt March 2020 COVID crossing.

## Uncertainty and limitations

The archive uses calendar-year block bootstrap uncertainty to preserve much of
the dependence from overlapping 63-session targets. Every reported 95% interval
crosses zero:

- AP gain: `[-0.007788, 0.048772]`
- Brier improvement: `[-0.001195, 0.005173]`
- Log-loss improvement: `[-0.004077, 0.021140]`
- ROC AUC gain: `[-0.059793, 0.033579]`

The researcher had already seen the incumbent 2016–2025 result before starting
the challenger study; only four distinct crisis crossings occur; the mapper is
mildly non-monotonic at extreme raw scores; and it misses exogenous jump risk.
The signal is for monitoring, not investment advice or standalone market
timing.

## Verdict and rerun criteria

The result is promising but statistically uncertain. Keep v2 in shadow mode;
do not promote it from this artifact. A future promotion requires a genuinely
unseen period/crisis, a refreshed point-in-time base-score snapshot, or a
separately registered stronger validation experiment. Thresholds must not be
tuned ad hoc against the displayed history.

Machine-readable values and the complete OOS history are preserved in
[`sp500-crisis-model-v2-2026-08-15.json`](sp500-crisis-model-v2-2026-08-15.json).
The implementation contract is in
[`SP500_CRISIS_MODEL_V2_TAB.md`](../../PRDs/2026-08-15/SP500_CRISIS_MODEL_V2_TAB.md).
