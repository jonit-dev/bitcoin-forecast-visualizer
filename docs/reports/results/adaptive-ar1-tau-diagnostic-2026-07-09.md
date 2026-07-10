# Adaptive AR(1) Residual-Decay Diagnostic

## Claim

- Asset: BTC.
- Target: daily close endpoint price.
- Candidate: estimate a causal expanding-window AR(1) coefficient for the residual around the current static power-law base, then use it instead of fixed `tau=210`.
- Decision scope: exploratory diagnostic only; no production change.

## Model

For residual `r_t = log(P_t / B_t)`, estimate at each origin:

`phi_o = clip(sum(r_(t-1) * r_t) / sum(r_(t-1)^2), 0, 0.9999)`

and forecast:

`F(o,h) = B_(o+h) * exp(phi_o^h * r_o)`.

The regression has no intercept and uses observations available through the origin close. The effective fitted tau is `-1/log(phi_o)`.

## Data and validation

- Source: checked-in daily `src/data/btc-history.json`.
- Structural base: current static power-law coefficients.
- Comparison models: fixed `tau=120` and production `tau=210`.
- Evaluation slices: origin dates in `2022-2024` and `2025+`.
- Metric: median absolute log error at `14/30/60/90d`.
- Limitations: report-only specialist diagnostic; static coefficient provenance is retrospective, the evaluation slices have already been inspected, and no immutable standalone command artifact was produced. Results are not confirmatory.

## Results

The expanding estimator implied an effective tau near `742-750` days during 2022-2026.

| Origin period | Horizon | tau=120 | tau=210 | expanding AR(1) |
| --- | ---: | ---: | ---: | ---: |
| 2022-2024 | 14d | 0.05163 | 0.05559 | 0.05922 |
| 2022-2024 | 30d | 0.08910 | 0.09020 | 0.09258 |
| 2022-2024 | 60d | 0.14450 | 0.14686 | 0.15335 |
| 2022-2024 | 90d | 0.16243 | 0.16579 | 0.18051 |
| 2025+ | 14d | 0.04893 | 0.04791 | 0.04845 |
| 2025+ | 30d | 0.06865 | 0.07209 | 0.07778 |
| 2025+ | 60d | 0.11581 | 0.12691 | 0.14815 |
| 2025+ | 90d | 0.11540 | 0.12863 | 0.14372 |

The adaptive model lost to fixed `tau=120` in seven of eight period/horizon cells and generally lost to `tau=210` at longer horizons. The near-unit-root estimate appears to absorb structural-base drift rather than useful forecast mean reversion.

## Decision

`rejected — diagnostic only`.

Do not implement or promote expanding AR(1) tau. A future adaptive-decay experiment would first need point-in-time structural-base refitting, an immutable reproducible script, a pre-specified estimator, and a fresh prospective holdout.
