# Backtest Results

`npm run backtest` writes timestamped JSON and Markdown reports in this directory.
`npm run backtest:ensemble-suite` writes the ensemble candidate report by calling `npm run backtest -- --ensemble-suite`.
`npm run backtest:tail-risk-suite` writes the tail-risk calibration report by calling `npm run backtest -- --tail-risk-suite`.
`npm run refit:powerlaw` writes timestamped power-law coefficient stability JSON and Markdown reports in this directory.
`npm run sweep:tau` writes timestamped mean-reversion tau sensitivity JSON and Markdown reports in this directory.
`npm run backtest:features-continuous` writes timestamped continuous feature residual dataset JSON and Markdown reports in this directory.
`npm run backtest:residual-model` writes timestamped kitchen-sink walk-forward residual model JSON and Markdown reports in this directory.

Required quality gate:

- `powerlaw-current` must beat `naive-current-price` on median absolute log error at 14, 30, 60, and 90 day horizons.
- The command exits non-zero if any required horizon fails.
- `npm run backtest:report-only` writes the same report without enforcing the exit-code gate.
- If ensemble or tail-risk config is explicitly enabled, `npm run backtest` also enforces the corresponding suite gate and exits non-zero when the enabled candidate no longer clears its comparison.

Report fields:

- `metadata`: command, git commit, dataset date range, row count, skipped windows, and model config snapshot.
- `horizons`: evaluated endpoint horizons in days.
- `models`: benchmark model ids and their configs.
- `metrics`: per-horizon, per-model samples, log-error metrics, NLL where a distribution exists, pinball losses, and interval coverage.
- `metrics.*.*.intervalWidthRatio`: mean interval width divided by median forecast for 80%, 90%, and 95% bands.
- `qualityGate`: pass/fail checks for the required horizons.
- `regimeSummary`: context-only error grouping by top lag-safe regime state.
- `ablation`: baseline/per-feature/full-regime enablement status; regime signals remain disabled unless the gate says otherwise.
- `candidateComparison`: present only when `npm run backtest -- --candidate-powerlaw latest` or an explicit refit JSON path is supplied; compares `powerlaw-current` against `powerlaw-refit-candidate`, including median error, bias, 80/90/95% coverage, and 80/90/95% interval-width ratios.
- `cycleComparison`: present only when `npm run backtest -- --cycle-suite` is supplied; compares deterministic future pivots against no-future-pivot, damped-pivot, and pivot-uncertainty strategies at 90/180/365 day horizons.
- `residualBootstrapComparison`: present only when `npm run backtest -- --residual-bootstrap-suite` is supplied; compares recent-730d, full-history, and volatility-regime residual policies, including high-volatility flagged-window coverage.
- `ensembleComparison`: present only when `npm run backtest -- --ensemble-suite` is supplied; lists validation-weighted member weights by horizon and compares `validation-weighted-ensemble` against the best single member at each gated horizon.
- `tailRiskComparison`: present only when `npm run backtest -- --tail-risk-suite` is supplied; compares conditional interval-width multipliers on flagged windows versus normal-window coverage and width guardrails.
- `feature-continuous-*`: shared residual-feature reports with lag-safe sample counts by feature family, holdout start, and horizon plus report-only continuous residual gates.
- `feature-continuous-*.families[].continuousGates`: pre-holdout ridge residual-model comparisons against the current residual-decay baseline. Each row includes train/eval rows, median and mean residual error, NLL, q10/q50/q90 pinball loss, 80% coverage, and block-bootstrap mean pinball-loss improvement intervals.
- Sparse event/state feature-family scripts remain diagnostics only. Their reports are not promotion gates unless the continuous residual report supports the same family.
- `residual-model-*`: report-only kitchen-sink residual model reports. Each evaluation records `trainingEndDate`, `originDate`, selected feature names, baseline/model q10/q50/q90 pinball loss, and 80% residual coverage proof that training ended before the evaluation origin.

Power-law refit report fields:

- `metadata`: command, git commit, dataset range, holdout start, minimum training window, and explicit stability thresholds.
- `currentConfig`: current `POWER_LAW_CONFIG.base` coefficients.
- `fitWindows`: expanding and rolling pre-origin fits; each window records training range, coefficients, and residual distribution.
- `coefficientSummary`: median, mean, standard deviation, p05, p25, p75, p95, drift from current config, and max window-to-window drift for each fitted term.
- `stabilityVerdict`: `stable`, `watch`, or `unstable` with numeric reasons.
- `forecastImpact`: coefficient-uncertainty forecast dispersion at 180 and 365 days.
- `suggestedConfig`: median fitted coefficients for opt-in candidate backtests. These are not enabled by default.

Tau sweep report fields:

- `metadata`: command, git commit, dataset range, gated horizons, and promotion policy.
- `candidates`: fixed tau candidates plus the volatility-conditional tau candidate, with metrics and per-horizon gate checks.
- `verdict`: retains the current 210-day tau unless a candidate is eligible for manual review across median error, bias, NLL, pinball loss, and 80/90/95% coverage.

Runtime summary:

- `src/data/powerlaw-stability-summary.json` is a compact artifact generated by `npm run refit:powerlaw`.
- The UI reads only this compact summary, not full refit reports.
- `watch` keeps long-horizon output scenario-based and notes that fixed coefficients are under review.
- `unstable` forces 180+ day labels toward directional/scenario wording instead of exact-confidence phrasing.

Automation:

- `npm run reports:refresh` updates required data, refreshes optional caches where possible, validates data, runs backtest, writes runtime summaries, and checks freshness.
- `.github/workflows/update-data-and-backtest.yml` runs the same refresh on a schedule and via manual dispatch.
