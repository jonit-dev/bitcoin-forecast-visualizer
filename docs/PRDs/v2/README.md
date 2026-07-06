# v2 PRD Index

Date: 2026-06-05  
Source roadmap: `ROADMAP-v2.md`

## Priority Order

Implement these PRDs in numeric order.

| Priority | PRD | Implement First Because |
| --- | --- | --- |
| P0 | `01-backtest-quality-lock.md` | It creates the validation gate required for all later claims. |
| P0 | `02-horizon-calibration.md` | It fixes probability calibration before new signals affect outputs. |
| P1 | `03-regime-data-feature-pipeline.md` | It adds the highest-value public data and lag-safe feature foundation. |
| P2/P3 | `04-regime-model-ui-automation.md` | It uses validated features for model/UI upgrades, then adds automation. |
| P2 | `05-power-law-coefficient-stability.md` | It tests whether fixed structural coefficients are stable enough for long-horizon trust. |
| P3 | `06-sentiment-data-context.md` | It adds optional sentiment context without enabling it as forecast alpha. |
| P3 | `07-market-data-quality-upgrade.md` | It makes BTC OHLCV provenance and UTC close conventions auditable before source promotion. |
| Next-level T1 | `08-core-model-assumption-hardening.md` | It batches the July 2026 core-model recommendations: rolling refit uncertainty, tau sweep, cycle-pivot ablation, and regime-mixed residual bootstraps. |
| Next-level T2 | `09-feature-experiment-redesign.md` | It redesigns failed P1 signal tests around continuous lag-safe residual features, longer holdouts, CRPS/pinball loss, pooling, buy-zone watch status, stablecoin retest, and the kitchen-sink residual model. |
| Next-level T3 | `10-ensemble-tail-risk-promotion.md` | It gates validation-weighted ensembles and tail-risk interval multipliers after T1/T2 evidence exists. |
| Next-level T4 | `11-engineering-hygiene-and-guardrails.md` | It captures cheap hardening: unit tests, seeded drawdown randomness, dead-code cleanup, one lockfile, stablecoin validation, UI bundle import guard, and secrets hygiene. |

## Execution Rules

- Do not enable a new forecast signal until `npm run backtest` proves it improves or preserves calibration out of sample.
- Every PRD must include and satisfy a regression safety gate: capture a pre-change baseline report, rerun the relevant backtest/build/validation checks after each phase, and prove the slice did not degrade current results unless an intentional tradeoff is explicitly documented with before/after metrics.
- Keep unproven regime, sentiment, ETF, macro, and derivatives signals as context-only.
- Treat 180-365 day outputs as scenarios unless calibration reports support stronger wording.
- Avoid importing large raw data files into the UI bundle without a size review.
- Preserve or deliberately replace the current `predev` behavior that updates both BTC and MVRV data.
- Keep sentiment optional and context-only unless ablation proves out-of-sample forecast value.
- Promote any upgraded BTC OHLCV source only after report-only comparison, validation, and backtest provenance checks.
- Treat the July 2026 next-level PRDs as evidence-gated follow-ons. Do not enable ensembles, tail-risk multipliers, or feature-family alpha before the relevant T1/T2 reports pass.
- Keep all failed or sample-starved P1 data families context-only until continuous-feature residual experiments prove out-of-sample value.
- Preserve long-horizon scenario/directional wording whenever coefficient, tau, cycle, or bootstrap verdicts are `watch` or `unstable`.

## July 2026 Assessment Coverage

Source: `docs/reports/next-level-forecasting-assessment.md`

| Assessment Recommendation | Owning PRD |
| --- | --- |
| Rolling power-law refit and coefficient uncertainty | `08-core-model-assumption-hardening.md` Phase 1, extending `05-power-law-coefficient-stability.md` |
| Tau sensitivity sweep and volatility-conditional tau | `08-core-model-assumption-hardening.md` Phase 2 |
| Replace deterministic future cycle pivots with removed, damped, or uncertain cycle alternatives | `08-core-model-assumption-hardening.md` Phase 3 |
| Extend residual lookback and regime-mix bootstrap residuals | `08-core-model-assumption-hardening.md` Phase 4 |
| Move from event-gated states to continuous features | `09-feature-experiment-redesign.md` Phases 1-2 |
| Extend ablation holdout to `2022-01-01` where data exists | `09-feature-experiment-redesign.md` Phase 3 |
| Add CRPS or pinball loss alongside NLL | `09-feature-experiment-redesign.md` Phase 2 |
| Kitchen-sink residual model experiment | `09-feature-experiment-redesign.md` Phase 4 |
| Validation-weighted ensemble of power-law, GBM-recent-drift, and MA-trend | `10-ensemble-tail-risk-promotion.md` Phase 1 |
| Calibrate and gate the tail-risk interval multiplier | `10-ensemble-tail-risk-promotion.md` Phase 2 |
| Unit tests for core model and feature join logic | `11-engineering-hygiene-and-guardrails.md` Phase 1 |
| Seed `Math.random()` Monte Carlo in `computeDrawdownStats` | `11-engineering-hygiene-and-guardrails.md` Phase 2 |
| Delete dead code and unused placeholder model options | `11-engineering-hygiene-and-guardrails.md` Phase 3 |
| Pick one lockfile/package manager | `11-engineering-hygiene-and-guardrails.md` Phase 5 |
| Add `validate:stablecoins` and a UI guard against importing `feature-table.json` | `11-engineering-hygiene-and-guardrails.md` Phase 4 |
| Keep buy-zone scoring as candidate/watch until sample evidence improves | `09-feature-experiment-redesign.md` Phase 3 |
| Retest stablecoin liquidity with continuous 30-90 day gates | `09-feature-experiment-redesign.md` Phase 3 |
| Move Gemini/local API keys out of plaintext-prone workflow guidance | `11-engineering-hygiene-and-guardrails.md` Phase 5 |

## Deferred From Core v2

- Neural-network forecasting.
- Cycle phase as alpha.
- Paid/vendor-locked data as a required dependency.
- Exact long-horizon target-price UX.
- Sentiment as a model input unless ablation proves value.
