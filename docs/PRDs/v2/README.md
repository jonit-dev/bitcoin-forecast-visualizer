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

## Execution Rules

- Do not enable a new forecast signal until `npm run backtest` proves it improves or preserves calibration out of sample.
- Keep unproven regime, sentiment, ETF, macro, and derivatives signals as context-only.
- Treat 180-365 day outputs as scenarios unless calibration reports support stronger wording.
- Avoid importing large raw data files into the UI bundle without a size review.
- Preserve or deliberately replace the current `predev` behavior that updates both BTC and MVRV data.
- Keep sentiment optional and context-only unless ablation proves out-of-sample forecast value.
- Promote any upgraded BTC OHLCV source only after report-only comparison, validation, and backtest provenance checks.

## Deferred From Core v2

- Neural-network forecasting.
- Cycle phase as alpha.
- Paid/vendor-locked data as a required dependency.
- Exact long-horizon target-price UX.
- Sentiment as a model input unless ablation proves value.
