# P3 Fat-Tail Distribution Evidence

Date: 2026-08-02

This artifact records the P3 implementation, report-only distribution-family verdict, required validation commands, and observed red negative controls. The Student-t candidate remains disabled.

## Implementation and PRD phase mapping

- Phase 1: `src/lib/predictiveDistribution.ts` adds log-normal and standardized Student-t families; `forecastInterval.ts`, production scoring, and backtest callers use the seam. Published Student-t values, normal convergence, q50 invariance, CDF round trips, n-1 variance, and log-normal golden quantiles are covered by tests.
- Phase 2: `forecastInterval.ts` uses `last.multiplier * sqrt(h / max fitted horizon)` above the fitted maximum, with scenario labels and monotonicity tests. The obsolete `aboveMaxMultiplier` path is removed.
- Phase 3: `data.ts` uses the median-consistent residual process without `-0.3 * sigma^2`; the dead `stressMultiplier` and `logDriftScale` configuration are removed. Heatmap median agreement and configuration hygiene are tested.
- Phase 4: `scripts/backtest-distribution-family.ts` uses disjoint fit/validation rows, the exact grid including `Infinity`, CRPS/Winkler/PIT/coverage/median metrics, horizon-length moving-block bootstrap, and Holm correction. The experiment was registered before the script run in `docs/reports/experiments-backlog.md`.

## Required command results

- `yarn test`: PASS — 28 test files, 137 tests.
- `yarn lint`: PASS — TypeScript no-emit check.
- `yarn build`: PASS — Vite production build; existing large-chunk warning only.
- `yarn backtest`: PASS — quality and robustness gates; power-law MALE was `0.05266/0.08375/0.13928/0.15347` for 14/30/60/90d versus naive `0.05447/0.08771/0.14696/0.18384`.
- `yarn backtest:report-only`: PASS — quality and robustness gates.
- `yarn backtest:pit-core`: PASS — 458 origin/horizon rows, 6 skips.
- `yarn backtest:distribution-family`: exit 0, report-only gate status `FAIL`; Infinity self-check passed exactly at all four horizons. Final artifact: `distribution-family-2026-08-02T23-35-46-064Z.json` and `.md`, generated from commit `d64644a1d203bc884d62e20d80c51d1380636a01` with clean working/source trees.
- `git diff --check`: PASS after restoring each mutation and after report generation.

The backtest artifacts are `backtest-2026-08-02T23-27-43-774Z`, `backtest-2026-08-02T23-27-49-967Z`, and `point-in-time-core-2026-08-02T23-27-56-964Z` in this directory.

## Promotion verdict from committed report numbers

The exact five-point gate fails. At 14d, selected fit `nu=10` versus validation `nu=4` fails the stability gate despite CRPS/coverage/PIT/median passing. At 30/60/90d, fit selects `Infinity`, so candidate CRPS and PIT do not improve. `DISTRIBUTION_CONFIG.defaultEnabled` is `false`, `kind` is `lognormal`, and no promotion evidence or runtime per-horizon `nu` values are populated. The empirical-shape residual-distribution follow-up is registered.

## Observed red negative controls and restored green results

Each mutation was applied to the committed implementation, the named check was run, and the exact source line was restored before the green rerun.

| Control mutation | Observed red result | Restored green result |
| --- | --- | --- |
| Scale the log-normal branch by `sqrt(3/5)` | `yarn test src/lib/__tests__/forecastInterval.test.ts`: 1 failed golden-quantile test; e.g. q025 `99490.83482537835` versus expected `93434.5744319942`. | Same command: 7 passed. |
| Return the normal quantile before Student-t inversion | `yarn test src/lib/__tests__/predictiveDistribution.test.ts`: 2 failed; published nu=3 value became `-1.959963986120195`, and round-trip p=.025 became `0.05364644872584891`. | Same command: 6 passed. |
| Replace above-maximum square-root extrapolation with a flat multiplier | `yarn test src/lib/__tests__/forecastInterval.test.ts`: 1 failed; 366d multiplier was `0.59` versus expected `0.5908076663603282`. | Same command: 7 passed. |
| Reintroduce `-0.3 * sigma^2` heatmap drift | `yarn test src/lib/__tests__/forecastPathStability.test.ts`: 1 failed; median log-gap was `0.013122807878575655`, above the `<0.01` gate. | Same command: 9 passed. |
| Add dead `INTERVAL_CONFIG.stressMultiplier` | `yarn test src/lib/__tests__/engineeringHygiene.test.ts`: 1 failed; expected property absence, received `true`. | Same command: 7 passed. |
| Map `Infinity` to Student-t `nu=3` | `yarn backtest:distribution-family`: failed with `Infinity candidate did not score identically to the log-normal baseline`. | Same command: exit 0, report-only `FAIL` verdict, exact Infinity self-check passed. |
| Set `DISTRIBUTION_CONFIG.defaultEnabled = true` without evidence/config | `yarn test src/lib/__tests__/forecastInterval.test.ts`: 4 failed with `enabled Student-t distribution requires per-horizon nu values and an exact results artifact`. | Same command: 7 passed. |

An intermediate probe mapping `Infinity` to Student-t `Infinity` stayed green because the implementation deliberately treats that value as the normal limit; it was replaced by the finite-`nu=3` control above.

## Manual checkpoint

No manual UI screenshot checkpoint was executed in this environment. No visual pass is claimed.
