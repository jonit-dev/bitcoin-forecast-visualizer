# Repository Instructions

## Experiment Registration

- Always register forecast, modeling, data-source, ablation, calibration, and research experiments in `docs/reports/experiments-backlog.md`.
- Register experiments whether they pass, fail, are rejected, or remain report-only.
- Include the date, status, hypothesis, data/source changes, validation setup, report artifacts, result/verdict, rerun criteria, and next better experiment.
- Do not implement product, UI, or forecast changes from an experiment unless the backlog entry points to a positive validated signal and the relevant backtest gate passes.

## Forecast Safety

- Keep unproven signals as context-only until `npm run backtest` proves they improve or preserve out-of-sample calibration.
- After forecast/model/data changes, run the relevant validation and regression checks before moving to the next change.
- Preserve report artifacts under `docs/reports/results/` when they are cited by runtime summaries, PRDs, or the experiments backlog.
