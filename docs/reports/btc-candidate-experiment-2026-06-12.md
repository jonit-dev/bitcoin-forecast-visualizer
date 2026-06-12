# BTC Forecast Candidate Experiment

## Claim

- Asset: BTC.
- Forecast target: daily close endpoint price.
- Horizon: 7, 14, 30, 60, 90, 180, and 365 calendar days.
- Candidate change: shorten power-law residual mean-reversion tau and test small one-day-lagged feature median adjustments.
- Current app baseline: `powerlaw-current` with 210-day residual mean-reversion tau.
- Naive baseline: current-price persistence from `npm run backtest:report-only`.
- Expected user-visible benefit: lower median endpoint forecast error without changing chart API or uncertainty-band semantics.

## Data

- Data sources: `src/data/btc-history.json`, `src/data/mvrv-history.json`, `src/data/onchain-history.json`, and `src/data/feature-table.json`.
- Date range: BTC rows from 2010-07-17 through 2026-06-11; feature rows from 2010-07-18 through 2026-06-04.
- Frequency: daily.
- Row count: 5,809 BTC rows; 5,801 feature rows.
- Missing values: BTC/MVRV/on-chain/feature validation passed; derivatives, ETF flow, and macro caches are unavailable or unconfigured.
- Timestamp timezone: UTC daily dates.
- Publication lag / point-in-time availability: feature rows are keyed by forecast origin date and use source dates one day earlier, as enforced by `scripts/build-feature-table.ts` and `npm run validate:features`.
- Exclusions: macro, ETF, and derivatives features were not used because local caches contain no configured rows.
- Leakage checks: no shuffled splits; final holdout begins 2025-01-01 and is not used for candidate selection.

## Pre-Registered Evaluation

- Train period: historical constants already in the app; no retraining on this pass.
- Validation period: 2022-01-01 through 2024-12-31.
- Final holdout period: 2025-01-01 through latest available target.
- Walk-forward schedule: daily rolling origin with contiguous target-window check.
- Primary metric: median absolute log error.
- Secondary metrics: mean absolute log error, paired mean improvement versus current model, and block-bootstrap lower 95% mean improvement.
- Minimum effect size: positive paired mean improvement with no median degradation on required horizons.
- Confidence level: 95%.
- Multiple-testing correction: candidate must survive the full required horizon set after testing five candidate families.
- Failure criteria: any required-horizon median degradation or non-positive lower 95% bootstrap bound downgrades the candidate to research-only.

## Results

- Commands run:
  - `npm run backtest:report-only`
  - `npm run validate:data`
  - `npm run research:btc-candidates`
  - `npm run lint`
- Artifact paths:
  - `docs/reports/results/backtest-2026-06-12T22-29-40-855Z.json`
  - `docs/reports/results/backtest-2026-06-12T22-29-40-855Z.md`
  - `docs/reports/results/btc-candidate-research-2026-06-12T22-33-06-945Z.json`
  - `docs/reports/results/btc-candidate-research-2026-06-12T22-33-06-945Z.md`
- Baseline metrics: existing `powerlaw-current` passed quality and robustness gates versus naive, driftless GBM, recent-drift GBM, and MA trend at 14/30/60/90 days.
- Candidate metrics: `tau-90` improved validation average median absolute log error from 0.114608 to 0.111526 and improved 2025+ final-holdout median error at 30/60/90/180 days, but slightly degraded 14-day median error.
- Effect size: `tau-90` 2025+ mean improvements were 0.000886 at 14d, 0.004247 at 30d, 0.010209 at 60d, and 0.011728 at 90d.
- Confidence interval: `tau-90` lower 95% block-bootstrap mean improvements were negative at 14d, 60d, and 90d.
- Statistical test and p-value: block bootstrap on paired absolute-log-error differences; no p-value was promoted because the confidence gate failed.
- Subperiod/regime robustness: feature adjustment candidates did not beat the baseline robustly; momentum and bear-penalty variants degraded required horizons.
- Parameter sensitivity: tau grid selected 90 days on validation, but 60-120 days were close enough to treat the result as promising, not conclusive.
- Runtime/performance impact: research script runs in a few seconds locally.

## Regression Controls

- Tests added or updated: added reproducible research command `npm run research:btc-candidates`.
- Existing tests run: `npm run lint`.
- Backtests run: `npm run backtest:report-only`.
- App behavior protected: no app-facing forecast defaults were changed.
- API/UI compatibility notes: no chart or data API shape changed.

## Independent Validation

- Validator: second-pass local review following the skill validator role.
- Verdict: downgrade all candidates to `research-only`.
- Issues found: tau shortening is promising but fails the strict 95% bootstrap gate across required horizons; feature rules are weak or harmful.
- Reproduction commands: `npm run validate:data && npm run backtest:report-only && npm run research:btc-candidates`.
- Math/proof review: median absolute log error uses `median(abs(log(predicted / actual)))`; paired improvement uses `current_abs_log_error - candidate_abs_log_error`; source features are point-in-time because each feature row uses source dates no later than origin date minus one day.

## Role Findings

- Data auditor: local BTC, MVRV, on-chain, and feature data are usable; macro/ETF/derivatives caches cannot support a claim yet.
- Signal miner: shorter residual tau and small value/MVRV adjustments are plausible; residual momentum and bear penalty are not supported.
- Backtest engineer: the current model already clears baseline robustness gates; candidate script preserves a 2025+ final holdout.
- Statistician/skeptic: no candidate clears the 95% confidence gate after the small candidate search.
- App integration reviewer: safest improvement is reproducible research/reporting, not changing the production forecast.

## Decision

Choose one: `research-only`.

- Rationale: `tau-90` is worth watching, but it does not clear the required bootstrap robustness gate across 14/30/60/90 days.
- Rollout recommendation: keep `powerlaw-current` as the default and rerun the candidate script as more 2026+ holdout data accumulates.
- Remaining risks: candidate search is small but still multiple-tested; final holdout is only about 520 daily origins at the shortest horizon and fewer at longer horizons.
