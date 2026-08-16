# S&P 500 Crisis Challenger v2 — Imported Evidence

Source: supplied `sp500-crisis-model-v2.zip`, model package version `0.2.0`.

## Verdict

The challenger is a promising but statistically uncertain calibration layer.
It is eligible for a user-facing shadow/context tab only; it is not promoted
into the forecaster's price or forecast-probability path.

## Locked holdout: 2016–2025

| Metric | Incumbent | Challenger v2 | Change |
|---|---:|---:|---:|
| Average precision | 0.225161 | 0.248045 | +0.022884 |
| ROC AUC | 0.658993 | 0.660583 | +0.001590 |
| Brier score | 0.084333 | 0.082754 | −0.001580 |
| Log loss | 0.310601 | 0.303813 | −0.006788 |

The locked holdout contains 438 rows and 43 positive outcomes. The model card
reports only four distinct crisis crossings, and the paired calendar-year
bootstrap intervals cross zero for AP gain, Brier improvement, and log-loss
improvement. Both models warned before 3 of 4 crossings and both missed the
abrupt March 2020 crossing.

## Current imported score

- Score as of: `2026-08-14`
- Base raw probability: `4.83%` (0.3496369834)
- Challenger deployment probability: `3.51%` (0.0351327435)
- Deployment thresholds: WATCH `10.69%`, HIGH `23.94%`
- Imported zone: `NORMAL`
- Target: cross 15% below the recent 252-session high within the next 63
  trading days

The lower challenger number is a calibration-curve effect, not independent
proof that market risk fell. The browser surface must keep the incumbent and
challenger values side by side and label the snapshot as imported/shadow mode.

## Provenance and rerun criteria

The package uses a strict development cutoff of `2015-09-23`, with the last
usable development row on `2015-09-18`, and an untouched 2016–2025 comparison.
The browser snapshot is derived from `data/oos_predictions.csv`,
`artifacts/current_score.json`, `artifacts/comparison.json`, and
`MODEL_CARD.md`; the Python `joblib` bundle is not executed by the web app.

Rerun before promotion for a genuinely unseen time period or crisis, a refreshed
base-model score snapshot, or a separately registered validation experiment.
Do not tune thresholds or mapper behavior against already-inspected holdout
results.
