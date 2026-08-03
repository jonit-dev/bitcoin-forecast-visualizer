# BTC FRED Macro Forecast Experiments

Status: `needs-rerun`; no production forecast, feature-table, interval, median, or UI behavior changed.

## Pre-registration

- Validation: 2018-01-01 through 2022-12-31.
- Untouched final holdout: 2023-01-01 through latest target with a complete horizon.
- Parameter selection cutoff: 2023-01-01; holdout selections recorded: 0.
- Horizons: 14, 30, 60, 90 days; primary metrics: mean log-score/NLL, mean absolute log error.
- Bootstrap: 2000 deterministic moving-block resamples, block length equal to forecast horizon; Holm correction across three arms and four horizons. The gate uses the one-sided lower bound named `bootstrapLower95OneSided`, not a two-sided interval.

## Data audit

- Source: FRED CSV; vintage: unspecified; fetched: 2026-07-07T00:12:56.962Z.
- Macro cache: 1093 rows, 2023-07-07 → 2026-07-03; signal rows: 1093.
- Required regime years: 2018=0, 2020=0, 2022=0.
- Target split: validation target leakage=0; late-2022 origins excluded because their targets cross the cutoff=194; holdout targets before cutoff=0.
- Revised FRED data research-only: yes.

## Baselines

| Horizon | Period | Power-law MALE | Naive MALE | Power-law NLL | Naive q50 | Power-law q50 |
|---:|---|---:|---:|---:|---:|---:|
| 14d | Validation+holdout origins | 0.090944 | 0.094216 | -0.684161 | 0.047108 | 0.045472 |
| 30d | Validation+holdout origins | 0.134418 | 0.147065 | -0.298610 | 0.073533 | 0.067209 |
| 60d | Validation+holdout origins | 0.196447 | 0.224928 | 0.025400 | 0.112464 | 0.098223 |
| 90d | Validation+holdout origins | 0.235793 | 0.285407 | 0.233052 | 0.142704 | 0.117896 |

- Naive benchmark comparison: median absolute log error and q50 pinball are applicable; NLL, 90% interval coverage, q05 pinball, and q95 pinball are not applicable because `naive-current-price` is median-only.

## Candidate arms

| Arm | Horizon | Parameter | Holdout NLL improvement | One-sided lower95 | Holm p | Coverage Δ | MALE Δ | Horizon-spaced one-sided lower95 | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| stress-interval | 14d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| stress-interval | 30d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| stress-interval | 60d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| stress-interval | 90d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| liquidity-median | 14d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| liquidity-median | 30d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| liquidity-median | 60d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| liquidity-median | 90d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| shock-interval | 14d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| shock-interval | 30d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| shock-interval | 60d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |
| shock-interval | 90d | n/a | n/a | n/a | n/a | n/a | n/a | n/a | needs-rerun |

## Validation-selected parameters

| Arm | 14d | 30d | 60d | 90d |
|---|---:|---:|---:|---:|
| stress-interval | n/a | n/a | n/a | n/a |
| liquidity-median | n/a | n/a | n/a | n/a |
| shock-interval | n/a | n/a | n/a | n/a |

## Mathematical leakage proof

- Availability: A macro row dated d is eligible at origin o only when row.availableAfter <= o; availableAfter is the latest contributing FRED observation date plus 30 calendar days.
- Rolling statistics: Every z-score at row i uses values from rows with index < i; the current observation is excluded from its own mean and variance.
- Target isolation: The target close at origin + horizonDays is read only after the forecast is constructed and is never used for signal construction or parameter selection.
- Selection isolation: Each arm and horizon selects its parameter by validation NLL only; holdout scores are computed after selection and cannot alter the parameter.
- Vintage limitation: The cache contains latest-revised FRED observations rather than ALFRED vintages. This proof prevents timestamp lookahead but cannot claim vintage safety; all results remain research-only.

## Arm verdicts and rerun policy

### stress-interval

Hypothesis: A point-in-time stress composite widens the current power-law interval when credit, financial conditions, volatility, dollar momentum, or curve inversion is stressed.

Formula: `sigma_candidate = sigma_powerlaw * (1 + scale * I(stressComposite >= 1)); median unchanged.`

Verdict: `needs-rerun` — needs more data: 14d needs more data: no usable validation signal rows; parameter selection is not defined; 30d needs more data: no usable validation signal rows; parameter selection is not defined; 60d needs more data: no usable validation signal rows; parameter selection is not defined; 90d needs more data: no usable validation signal rows; parameter selection is not defined. Rerun after an authenticated BTC-era cache is available.

- Rerun only after an ALFRED/vintage-safe cache, a pre-registered split, and the same untouched-holdout gate.
- Next better experiment: rerun this arm with historical vintages and a publication-date field, then validate on a newly accumulated holdout.

### liquidity-median

Hypothesis: A point-in-time liquidity composite shifts the log median while leaving the baseline interval scale unchanged.

Formula: `log(median_candidate) = log(median_powerlaw) + coefficient * liquidityComposite.`

Verdict: `needs-rerun` — needs more data: 14d needs more data: no usable validation signal rows; parameter selection is not defined; 30d needs more data: no usable validation signal rows; parameter selection is not defined; 60d needs more data: no usable validation signal rows; parameter selection is not defined; 90d needs more data: no usable validation signal rows; parameter selection is not defined. Rerun after an authenticated BTC-era cache is available.

- Rerun only after an ALFRED/vintage-safe cache, a pre-registered split, and the same untouched-holdout gate.
- Next better experiment: rerun this arm with historical vintages and a publication-date field, then validate on a newly accumulated holdout.

### shock-interval

Hypothesis: A positive 30-day shock in the point-in-time stress composite widens the interval without moving the median.

Formula: `sigma_candidate = sigma_powerlaw * (1 + multiplier * I(stressShockZ30d >= 1)); median unchanged.`

Verdict: `needs-rerun` — needs more data: 14d needs more data: no usable validation signal rows; parameter selection is not defined; 30d needs more data: no usable validation signal rows; parameter selection is not defined; 60d needs more data: no usable validation signal rows; parameter selection is not defined; 90d needs more data: no usable validation signal rows; parameter selection is not defined. Rerun after an authenticated BTC-era cache is available.

- Rerun only after an ALFRED/vintage-safe cache, a pre-registered split, and the same untouched-holdout gate.
- Next better experiment: rerun this arm with historical vintages and a publication-date field, then validate on a newly accumulated holdout.

## Reproducibility

- Refresh data: `yarn update:macro`.
- Run targeted tests: `yarn test src/lib/__tests__/fredMacroFeatures.test.ts`.
- Run experiment: `yarn backtest:fred-macro`.
- Artifacts: `/home/joao/projects/bitcoin-forecast-visualizer/docs/reports/results/btc-fred-macro-experiments.json`, `/home/joao/projects/bitcoin-forecast-visualizer/docs/reports/results/btc-fred-macro-experiments.md`.

## Regression decision

- Production model and feature-table consumers are unchanged.
- Latest-revised FRED observations are explicitly research-only; no vintage leakage claim is made.
