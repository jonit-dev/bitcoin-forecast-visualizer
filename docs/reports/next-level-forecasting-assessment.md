# Forecasting Quality Assessment & Next Steps

Date: 2026-07-06
Scope: full-project inspection — model code (`src/lib`), backtest harness and persisted results (`docs/reports/results/`), data pipelines (`scripts/`, GitHub Actions), and UI.

## TL;DR

The project is in unusually good shape for a hobby-scale forecasting tool: the backtest harness is genuinely rigorous (walk-forward, rolling origins, block-bootstrap robustness gates, deterministic seeds, config snapshots per run), intervals at 14–90d are well calibrated, and the power-law model beats naive/GBM baselines with statistical significance at every gated horizon. P0 of ROADMAP-v2 is done and done well.

The honest headline, though: **every single P1 signal failed its promotion gate** (on-chain, derivatives, ETF flows, macro, sentiment, stablecoins, COT — all rejected or context-only as of the 2026-06-26 ablation runs). Reliability is stuck at 58/100 not because the harness is weak, but because the added data hasn't demonstrated out-of-sample value *the way it was tested*. There **is** room for improvement — but it's in how features are constructed and evaluated, and in a few real methodological soft spots in the core model, not in adding more data sources.

## Where the project stands

### What's working (verified against latest reports)

| Metric | Target (v2) | Actual (backtest 2026-06-12) |
| --- | --- | --- |
| 14d median error | ≤ 6% | **5.4%** ✅ |
| 30d median error | ≤ 9% | **8.7%** ✅ |
| 90d median error | ≤ 15% | 16.8% ❌ (close) |
| 80/90/95% coverage, 14–90d | in band | 76.5–84%, 89.7–90.2%, 93.2–95.8% ✅ |
| Beats naive + GBM at 14/30/60/90d | required | ✅ with bootstrap lower bound > 0 |
| Reproducibility | one command | ✅ `npm run backtest`, config + commit hash embedded |

Data pipeline is automated (daily cron at 14:15 UTC → update all sources → rebuild features → freshness gate → commit + deploy) and all core sources were ≤ 1 day stale as of 2026-07-01 (COT at 8 days, which is structural to CFTC publishing).

### Two false alarms, corrected during inspection

- **`.env` with real API keys exists locally but was never committed** — `.gitignore`'s `.env*` pattern covers it and `git log --all -- .env` is empty. No rotation emergency. (Still worth moving the Gemini key out of a plaintext file eventually.)
- **The 17 MB `feature-table.json` is *not* in the UI bundle** — `dist/` is 2.5 MB total; `App.tsx` imports only `buy-zone-summary.json` and a type. The heavy import in `features.ts`/`buyZone.ts` only affects scripts/server. No bundle crisis — but it's one careless import away from becoming one, so a lint guard would be cheap insurance.

## Real weaknesses in the core model

These came out of reading the actual math, and they matter more than any new data source:

1. **Hardcoded future cycle pivots leak assumptions into live forecasts** (`cycle.ts:37-59`, `data.ts:152-186`). The forecast interpolates toward projected ATH/ATL dates assuming a fixed 1064d ATL→ATH / 364d ATH→ATL rhythm, extrapolated decades forward. The 2021 cycle already violated this. This is the single most fragile assumption in the model — it's an opinion wearing a formula's clothes, and it gets up to 100% weight beyond T+100d.

2. **Mean-reversion tau = 210 days is a constant that has never been validated** (`powerLaw.ts:4`). It controls both the median path's pull toward the power-law and the residual decay in interval variance. No sensitivity analysis exists anywhere in the repo.

3. **Interval multipliers may be overfit to one holdout window** (`modelConfig.ts:33-46`). The fitted multipliers *shrink* with horizon (1.01 at 14d → 0.59 at 365d), which is suspicious: it likely reflects the specific 2022–2026 holdout (crash → range → recovery) rather than a general property. The holdout misses 2017–2018 and the 2020 COVID crash entirely.

4. **Stochastic residual lookback is only 730 days** (`data.ts:45`), so Monte Carlo traces and the heatmap encode only recent-regime volatility. Tail risk in a 2020-style shock is underrepresented.

5. **Power-law coefficients are fixed and were fit on all history including the holdout era** — P2.1 (rolling refit + coefficient stability as a live input) remains unchecked in the roadmap. `powerLawFit.ts` computes stability verdicts but nothing branches on them.

6. **`Math.random()` in `computeDrawdownStats`** (`data.ts:~543`) breaks determinism for drawdown estimates while everything else is seeded — a small inconsistency worth fixing.

7. **Core model logic has near-zero test coverage.** The 3 test files cover the chart and the API. `powerLaw.ts`, `forecastInterval.ts`, `regimeModel.ts`, `buyZone.ts`, `tailRisk.ts`, and the feature-table join logic are untested.

## Why all the P1 signals failed — and why that's not the final word

Reading the 2026-06-26 ablation reports, the rejections share one pattern: **sample starvation, not proven worthlessness.**

- On-chain interaction states: 0–1 thinned holdout samples per horizon.
- Macro regimes: FRED history only starts 2023-06, leaving 0–3 samples per regime.
- COT: 19 weekly samples at 7d, down to 2 at 60d.
- Sentiment extremes: 3–25 samples per event.

With holdout starting 2025-01-01 and event thinning, most of these tests were statistically incapable of passing regardless of whether the signal is real. The gates are honest — good — but the experimental design guarantees rejection for rare-event features. The fix is longer evaluation windows, continuous (not event-gated) features, and pooling across related states, not abandoning the data.

Two things did show signs of life: **buy-zone scoring** (candidate status: 8 historical heavy-buy instances, +99% median 1y forward, correctly not promoted on small n) and **stablecoin liquidity features** (context-only, inconsistent but nonzero improvements at 30–90d).

## Recommended next steps, in order

### Tier 1 — attack the core model's soft spots (highest expected value)

1. **P2.1: Rolling power-law refit + coefficient uncertainty.** Refit `(a, b, c1, c2)` using only data before each rolling origin; measure coefficient drift; propagate coefficient uncertainty into interval width at long horizons. This directly addresses weaknesses 3 and 5 and is already scaffolded (`refit-power-law.ts`, `powerlaw-refit-candidate` in `backtestModels.ts`).
2. **Tau sensitivity sweep.** Backtest tau ∈ {60, 90, 120, 150, 210, 300, 420} per horizon; then test a volatility-conditional tau (fast reversion in high-vol regimes). Cheap experiment, touches every forecast.
3. **Replace deterministic cycle pivots with a damped/uncertain cycle.** Options to A/B in the harness: (a) drop the pivot interpolation entirely beyond the sinusoidal term, (b) widen intervals with pivot-timing uncertainty, (c) make cycle amplitude decay with cycle number (each cycle's peak-over-trend has been shrinking). Gate on 90–365d error and coverage.
4. **Extend the residual lookback / regime-mix the bootstrap.** Sample Monte Carlo blocks from full history stratified by volatility regime instead of the last 730 days only.

### Tier 2 — redesign the feature experiments so they can actually pass

5. **Move from event-gated states to continuous features.** Instead of "macro-stress regime active yes/no" (3 samples), test whether a continuous z-scored feature improves quantile loss / NLL across *all* days via a small regularized regression on the residual. This multiplies effective sample size by ~100×.
6. **Extend ablation holdout back to 2022-01-01** (matching the main backtest) for features whose data exists that far back (on-chain, sentiment, stablecoins). The 2025-only holdout is the main reason for sample starvation.
7. **CRPS / pinball-loss as the promotion metric** alongside NLL — NLL is brutal on small samples and dominated by single outliers.
8. **One "kitchen-sink residual model" experiment:** lag-safe feature table → gradient-boosted or ridge regression predicting the h-day-ahead power-law residual, walk-forward, compared against the pure decay model. If this can't beat `exp(-h/tau)` reversion, that's a genuine, publishable-quality negative result and you can confidently stop adding data sources.

### Tier 3 — model ensemble & tail risk (only after Tier 1/2)

9. **P2.3 ensemble:** validation-weighted blend of power-law, GBM-recent-drift, and MA-trend per horizon. The scaffold exists (`ensembleForecast.ts`) with weights hardcoded to `{powerlaw: 1}`.
10. **Calibrate the tail-risk multiplier** (`tailRisk.ts` computes 1.0–1.35 but never applies it). Backtest as a conditional interval-width adjustment gated on coverage-in-flagged-periods.

### Tier 4 — engineering hygiene (cheap, do opportunistically)

11. Unit tests for `powerLaw.ts`, `forecastInterval.ts`, `features.ts` join/lag logic (the lookahead-bias guarantee currently rests on untested code).
12. Seed the `Math.random()` Monte Carlo in `computeDrawdownStats`.
13. Delete dead code: `legacyStressMultiplierForHorizon`, unused placeholder model options in the UI selector.
14. Pick one lockfile (workflow uses yarn; drop `package-lock.json`).
15. Add a `validate:stablecoins` script to match the other pipelines, and a guard against importing `feature-table.json` from UI code.

## Experiments scoreboard (proposed)

| # | Experiment | Cost | Expected value | Gate |
| --- | --- | --- | --- | --- |
| 1 | Rolling power-law refit + uncertainty | Medium | High | Beats fixed coefficients at 90–365d, coverage held |
| 2 | Tau sweep + vol-conditional tau | Low | High | Median error / NLL at 14–90d |
| 3 | Cycle-pivot ablation (remove / dampen / widen) | Low | High | 90–365d error + honest coverage |
| 4 | Regime-stratified bootstrap residuals | Low | Medium | 95% coverage in high-vol subperiods |
| 5 | Continuous-feature residual regression | Medium | High | CRPS vs pure decay, walk-forward from 2022 |
| 6 | Ensemble (validation-weighted) | Low | Medium | Beats best single model ≥ 1 horizon, calibration held |
| 7 | Tail-risk multiplier calibration | Low | Medium | Coverage in flagged windows improves |

## Bottom line

Yes, there's room for improvement — but the frontier has moved. The 2025 version of this project needed infrastructure and data; it now has both, plus a harness good enough to kill bad ideas (which it has been doing, correctly). The next reliability points come from (1) fixing the fragile deterministic-cycle and fixed-coefficient assumptions in the core model, and (2) re-running the feature experiments with designs that have enough statistical power to detect a real signal. If experiment #5 (continuous residual regression) and #1 (rolling refit) both fail to beat the current baseline, you'll have earned the strongest claim available in this domain: a calibrated, honest, hard-to-beat reference model — which is its own kind of next-level.
