# Model promotion — 2026-08-17

Two research bundles were re-gated against this repository's own immutable
snapshots and promoted. Both sandboxes are reproducible; neither bundle's own
numbers were taken on trust.

## S&P 500 / VOO — Causal Session-Residual v1 (full promotion)

`sp500_csr_v1_sandbox` scored its challenger on an archived S&P/SPY-like proxy
because the VOO bundle was not accessible to it, and it explicitly deferred the
promotion gate until a rerun on the exact snapshot. That rerun was done here.

| Run | short-horizon MAE | short-horizon pinball | all-horizon MAE | all-horizon pinball | gate |
|---|---:|---:|---:|---:|---|
| Sandbox proxy (reproduction) | +4.49% | +6.42% | +24.76% | +25.13% | pass |
| Real `voo-history.json`, with macro | +4.44% | +6.28% | +24.72% | +24.99% | pass |
| Real `voo-history.json`, price-only | **+5.18%** | **+6.78%** | **+25.21%** | **+25.33%** | pass |

The **price-only** variant is the one deployed. `rf`/`inflation` are FRED series
whose published values are latest revisions rather than point-in-time vintages;
the candidate spec calls for a formally evaluated price-only variant rather than
a silent backfill, and that variant also scores better.

Per-horizon MAE improvement on the untouched 2022-2025 target-date holdout:

| horizon | 7 | 14 | 30 | 90 | 180 | 365 | 730 | 1825 | 3650 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MAE | −0.3% | +0.3% | −0.4% | +6.4% | 0.0% | +20.7% | +35.8% | +75.9% | +84.1% |

Gains are concentrated at a year and beyond; the short end is a wash by design
(trust weights 0.4/0.3/0.8/0.9) and 180d keeps the incumbent exactly (weight 0).

Implementation: `src/lib/csrV1.ts`, artifact `src/data/voo-csr-v1-residuals.json`
(five depth-1 stump ensembles, refit cutoff 2026-01-01, trained on
`voo-history.json` through 2026-08-14). The TS inference reproduces sklearn's
predictions bit for bit — see the golden values in `src/lib/__tests__/csrV1.test.ts`.

Session counts come from `shared/us-market-calendar.mjs`, not a 252/365
approximation. Validated against observed VOO session counts: worst case 2-3
sessions of drift at the 5-10 year anchors, from ad-hoc historical closures.

## Gold / GLD — direct 365-day Ridge (365-day horizon only)

`gld-v2-sandbox` reproduces on this repo's `gld-history.json` and, retrained on
live FRED macro, improves further:

| Period | MAE change vs baseline | Direction acc. | Baseline direction acc. |
|---|---:|---:|---:|
| Validation 2015-2018 | −37.6% | 63.6% | 24.4% |
| **Stress gap 2019** | **+14.6% worse** | 84.6% | 76.9% |
| Holdout 2020-2025 | **−33.2%** | 83.8% | 69.1% |

Promoted at **365 days only**. Every other horizon keeps the momentum baseline,
which is what the horizon gate found: validation winners at 7/14/30/90/180 all
lost on their holdouts, and 730d+ has too little history for a credible gate.

Caveats that did not block promotion but should govern how the number is read:

- The model was worse than the baseline for 2019 and 2021 origins. This is a
  real regime failure, not a cosmetic caveat.
- One-year weekly errors overlap ~52 observations. HAC test on the 2020-2025
  holdout gives two-sided p = 0.0967; a 52-week circular block bootstrap puts
  the MAE ratio at 0.70 with a 95% interval of roughly [0.47, 1.10] — the
  interval still contains "no improvement".
- Only 17 of 50 standardized coefficients are nonzero and the output is
  dominated by the absolute 10-year real-yield proxy and the broad-dollar level.
  These are predictive associations, not causal claims.

The interval keeps the incumbent's `sigma * sqrt(365)` width on purpose; the
narrower calibrated scale looked better on 2020-2025 but failed the 2019 gap.

Implementation: `src/lib/gold365V2.ts`, artifact `src/data/gold-365-v2-model.json`,
macro cache `src/data/gold-macro-history.json` (`yarn update:gold-macro`). The TS
port reproduces the offline log return to 1e-16.

## Fail-closed behaviour

Both models return null and hand back to the incumbent when an input is
unusable: a snapshot shorter than the trained minimum, a missing residual on a
weighted horizon, a non-monotonic session ladder, or a macro cache that does not
reach the session before the origin. A stale gold macro feed silently reverts
the 365-day surface to the momentum baseline rather than forecasting off a
carried-forward value of unknown age.

## Not promoted

- GLD at 7/14/30/90/180/730/1825/3650 days.
- Any recalibrated interval width for either asset.
- The VOO structural channel rendering change in the candidate spec (§10).
