# BTC Forecast Candidate Experiment

## Claim

- Asset: BTC.
- Forecast target: daily close endpoint price.
- Horizon: 7, 14, 30, 60, 90, 180, and 365 calendar days.
- Candidate change: shorten power-law residual mean-reversion tau, test small one-day-lagged feature median adjustments, and test validation-selected interval scale factors.
- Current app baseline: `powerlaw-current` with 210-day residual mean-reversion tau.
- Naive baseline: current-price persistence from `npm run backtest:report-only`.
- Expected user-visible benefit: lower median endpoint forecast error or better calibrated uncertainty bands without changing chart API semantics.

## Data

- Data sources: `src/data/btc-history.json`, `src/data/mvrv-history.json`, `src/data/onchain-history.json`, and `src/data/feature-table.json`.
- Date range: BTC rows from 2010-07-17 through 2026-06-11; feature rows from 2010-07-18 through 2026-06-11.
- Frequency: daily.
- Row count: 5,809 BTC rows; 5,808 feature rows.
- Missing values: BTC/MVRV/on-chain/feature validation passed after refreshing on-chain data through 2026-06-11; derivatives, ETF flow, and macro caches are unavailable or unconfigured.
- Timestamp timezone: UTC daily dates.
- Publication lag / point-in-time availability: feature rows are keyed by forecast origin date and use source dates one day earlier, as enforced by `scripts/build-feature-table.ts` and `npm run validate:features`.
- Provenance correction: residual momentum features use the current residual and a prior residual, so their `sourceDates` must record the latest source date used, not the prior comparison date. This was fixed in `scripts/build-feature-table.ts` and locked in `scripts/validate-feature-table.ts`.
- Exclusions: macro, ETF, and derivatives features were not used because local caches contain no configured rows.
- Leakage checks: no shuffled splits; final holdout begins 2025-01-01 and is not used for candidate selection.

## Pre-Registered Evaluation

- Train period: historical constants already in the app; no retraining on this pass.
- Validation period: 2022-01-01 through 2024-12-31.
- Final holdout period: 2025-01-01 through latest available target.
- Walk-forward schedule: daily rolling origin with contiguous target-window check.
- Primary metric: median absolute log error.
- Secondary metrics: mean absolute log error, paired mean improvement versus current model, block-bootstrap lower 95% mean improvement, interval NLL, pinball loss, and 80/90/95% interval coverage.
- Minimum effect size: positive paired mean improvement with no median degradation on required horizons.
- Confidence level: 95%.
- Multiple-testing correction: candidate must survive the full required horizon set after testing median candidate families plus interval scale candidates.
- Failure criteria: any required-horizon median degradation or non-positive lower 95% bootstrap bound downgrades the candidate to research-only.

## Results

- Commands run:
  - `npm run update:onchain`
  - `npm run backtest:report-only`
  - `npm run build:features`
  - `npm run validate:data`
  - `npm run research:btc-candidates`
  - `npm run write:runtime-summaries`
  - `npm run check:freshness`
  - `npm run lint`
- Artifact paths:
  - `docs/reports/results/backtest-2026-06-12T22-29-40-855Z.json`
  - `docs/reports/results/backtest-2026-06-12T22-29-40-855Z.md`
  - `docs/reports/results/backtest-2026-06-12T22-42-22-260Z.json`
  - `docs/reports/results/backtest-2026-06-12T22-42-22-260Z.md`
  - `docs/reports/results/btc-candidate-research-2026-06-12T22-33-06-945Z.json`
  - `docs/reports/results/btc-candidate-research-2026-06-12T22-33-06-945Z.md`
  - `docs/reports/results/btc-candidate-research-2026-06-12T22-42-36-301Z.json`
  - `docs/reports/results/btc-candidate-research-2026-06-12T22-42-36-301Z.md`
- Baseline metrics: existing `powerlaw-current` passed quality and robustness gates versus naive, driftless GBM, recent-drift GBM, and MA trend at 14/30/60/90 days.
- Candidate metrics: `tau-90` improved validation average median absolute log error from 0.114608 to 0.111526 and improved 2025+ final-holdout median error at 30/60/90/180 days, but slightly degraded 14-day median error.
- Effect size: `tau-90` 2025+ mean improvements were 0.000886 at 14d, 0.004247 at 30d, 0.010209 at 60d, and 0.011728 at 90d.
- Confidence interval: `tau-90` lower 95% block-bootstrap mean improvements were negative at 14d, 60d, and 90d.
- Statistical test and p-value: block bootstrap on paired absolute-log-error differences; no p-value was promoted because the confidence gate failed.
- Subperiod/regime robustness: feature adjustment candidates did not beat the baseline robustly; momentum and bear-penalty variants degraded required horizons.
- Interval candidates: validation NLL selected scales of 1.0 through 60d, 1.1 at 90d, and 0.95 at 180/365d, but these worsened 90d/180d/365d final-holdout NLL and coverage, so no interval config change is justified.
- Parameter sensitivity: tau grid selected 90 days on validation, but 60-120 days were close enough to treat the result as promising, not conclusive.
- Data-quality finding: residual momentum feature provenance understated recency before this pass; the feature table was rebuilt and the validator now rejects stale residual momentum source dates.
- Runtime/performance impact: research script runs in a few seconds locally.

## Regression Controls

- Tests added or updated: added interval candidate checks to `npm run research:btc-candidates`; tightened `npm run validate:features` to reject stale residual momentum source dates.
- Existing tests run: `npm run validate:features`, `npm run validate:data`, and `npm run lint`.
- Backtests run: `npm run backtest:report-only`.
- App behavior protected: no app-facing forecast defaults were changed.
- API/UI compatibility notes: no chart or data API shape changed.

## Independent Validation

- Validator: second-pass local review following the skill validator role.
- Verdict: downgrade all candidates to `research-only`.
- Issues found: tau shortening is promising but fails the strict 95% bootstrap gate across required horizons; feature rules are weak or harmful; validation-selected interval scaling does not survive the final holdout.
- Reproduction commands: `npm run build:features && npm run validate:data && npm run backtest:report-only && npm run research:btc-candidates`.
- Math/proof review: median absolute log error uses `median(abs(log(predicted / actual)))`; paired improvement uses `current_abs_log_error - candidate_abs_log_error`; source features are point-in-time because each feature row uses source dates no later than origin date minus one day.

## Role Findings

- Data auditor: local BTC, MVRV, on-chain, and feature data are usable after the residual momentum source-date fix; macro/ETF/derivatives caches cannot support a claim yet.
- Signal miner: shorter residual tau and small value/MVRV adjustments are plausible; residual momentum, bear penalty, and interval rescaling are not supported.
- Backtest engineer: the current model already clears baseline robustness gates; candidate script preserves a 2025+ final holdout.
- Statistician/skeptic: no candidate clears the 95% confidence gate after the small candidate search.
- App integration reviewer: safest forecast decision is no production median/interval change; the implementation-ready change is data provenance validation.

## Decision

Choose one: `research-only` for forecast changes; `implementation-ready` for the feature provenance fix.

- Rationale: `tau-90` is worth watching, but it does not clear the required bootstrap robustness gate across 14/30/60/90 days. Interval scaling fails final-holdout NLL/coverage. The source-date fix is deterministic and regression-protected by validation.
- Rollout recommendation: keep `powerlaw-current` as the default and rerun the candidate script as more 2026+ holdout data accumulates.
- Remaining risks: candidate search is small but still multiple-tested; final holdout is only about 520 daily origins at the shortest horizon and fewer at longer horizons.
