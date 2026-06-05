# Backtest Results

`npm run backtest` writes timestamped JSON and Markdown reports in this directory.

Required quality gate:

- `powerlaw-current` must beat `naive-current-price` on median absolute log error at 14, 30, 60, and 90 day horizons.
- The command exits non-zero if any required horizon fails.
- `npm run backtest:report-only` writes the same report without enforcing the exit-code gate.

Report fields:

- `metadata`: command, git commit, dataset date range, row count, skipped windows, and model config snapshot.
- `horizons`: evaluated endpoint horizons in days.
- `models`: benchmark model ids and their configs.
- `metrics`: per-horizon, per-model samples, log-error metrics, NLL where a distribution exists, pinball losses, and interval coverage.
- `qualityGate`: pass/fail checks for the required horizons.
- `regimeSummary`: context-only error grouping by top lag-safe regime state.
- `ablation`: baseline/per-feature/full-regime enablement status; regime signals remain disabled unless the gate says otherwise.

Automation:

- `npm run reports:refresh` updates required data, refreshes optional caches where possible, validates data, runs backtest, writes runtime summaries, and checks freshness.
- `.github/workflows/update-data-and-backtest.yml` runs the same refresh on a schedule and via manual dispatch.
