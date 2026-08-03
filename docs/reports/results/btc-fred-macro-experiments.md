# BTC FRED Macro Forecast Experiments

Status: `context-only`; no production forecast, feature-table, interval, median, or UI behavior changed.

## Pre-registration

- Validation: 2018-01-01 through 2022-12-31.
- Untouched final holdout: 2023-01-01 through latest target with a complete horizon.
- Parameter selection cutoff: 2023-01-01; holdout selections recorded: 0.
- Horizons: 14, 30, 60, 90 days; primary metrics: mean log-score/NLL, mean absolute log error.
- Bootstrap: 2000 deterministic moving-block resamples, block length equal to forecast horizon; Holm correction across three arms and four horizons. The gate uses the one-sided lower bound named `bootstrapLower95OneSided`, not a two-sided interval.

## Data audit

- Source: FRED observations API; vintage: latest-revised observations; not an ALFRED vintage; fetched: 2026-08-03T08:18:05.487Z.
- Macro cache: 5844 rows, 2010-08-01 → 2026-07-31; signal rows: 5844.
- Required regime years: 2018=365, 2020=366, 2022=365.
- Credit-spread source: BAAFF (Moody's Baa-minus-fed-funds historical credit-spread proxy); limitation: BAAFF is a historical Moody's Baa-minus-fed-funds proxy; it is not equivalent to the ICE/BofA high-yield option-adjusted spread BAMLH0A0HYM2.
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
| stress-interval | 14d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| stress-interval | 30d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| stress-interval | 60d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| stress-interval | 90d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| liquidity-median | 14d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| liquidity-median | 30d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| liquidity-median | 60d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| liquidity-median | 90d | -0.050000 | -0.030257 | -0.109442 | 1.000000 | -0.018395 | 0.000236 | 0.007005 | context-only |
| shock-interval | 14d | 0.100000 | -0.002779 | -0.008821 | 1.000000 | 0.001572 | 0.000000 | -0.004456 | context-only |
| shock-interval | 30d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| shock-interval | 60d | 0.000000 | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | 0.000000 | context-only |
| shock-interval | 90d | 0.100000 | -0.003102 | -0.008560 | 1.000000 | 0.006689 | 0.000000 | -0.006073 | context-only |

## Validation-selected parameters

| Arm | 14d | 30d | 60d | 90d |
|---|---:|---:|---:|---:|
| stress-interval | 0.000000 | 0.000000 | 0.000000 | 0.000000 |
| liquidity-median | 0.000000 | 0.000000 | 0.000000 | -0.050000 |
| shock-interval | 0.100000 | 0.000000 | 0.000000 | 0.100000 |

## Mathematical leakage proof

- Availability: A macro row dated d is eligible at origin o only when row.availableAfter <= o; availableAfter is the latest contributing FRED observation date plus 30 calendar days.
- Rolling statistics: Every z-score at row i uses values from rows with index < i; the current observation is excluded from its own mean and variance.
- Target isolation: The target close at origin + horizonDays is read only after the forecast is constructed and is never used for signal construction or parameter selection.
- Selection isolation: Each arm and horizon selects its parameter by validation NLL only; holdout scores are computed after selection and cannot alter the parameter.
- Vintage limitation: The cache contains latest-revised FRED observations rather than ALFRED vintages. This proof prevents timestamp lookahead but cannot claim vintage safety; all results remain research-only.
- Credit proxy limitation: BAAFF is a historical Moody's Baa-minus-fed-funds proxy; it is not equivalent to the ICE/BofA high-yield option-adjusted spread BAMLH0A0HYM2.

## Arm verdicts and rerun policy

### stress-interval

Hypothesis: A point-in-time stress composite widens the current power-law interval when credit, financial conditions, volatility, dollar momentum, or curve inversion is stressed.

Formula: `sigma_candidate = sigma_powerlaw * (1 + scale * I(stressComposite >= 1)); median unchanged.`

Verdict: `context-only` — The numerical promotion gate failed: 14d mean NLL improvement is not positive; 14d daily block-bootstrap one-sided lower95 is not positive; 14d Holm-adjusted p-value is not below 0.05; 14d horizon-spaced robustness failed; 14d candidate forecast outputs are identical to baseline; 30d mean NLL improvement is not positive; 30d daily block-bootstrap one-sided lower95 is not positive; 30d Holm-adjusted p-value is not below 0.05; 30d horizon-spaced robustness failed; 30d candidate forecast outputs are identical to baseline; 60d mean NLL improvement is not positive; 60d daily block-bootstrap one-sided lower95 is not positive; 60d Holm-adjusted p-value is not below 0.05; 60d horizon-spaced robustness failed; 60d candidate forecast outputs are identical to baseline; 90d mean NLL improvement is not positive; 90d daily block-bootstrap one-sided lower95 is not positive; 90d Holm-adjusted p-value is not below 0.05; 90d horizon-spaced robustness failed; 90d candidate forecast outputs are identical to baseline. Keep the signal context-only.

- Rerun only after an ALFRED/vintage-safe cache, a pre-registered split, and the same untouched-holdout gate.
- Next better experiment: rerun this arm with historical vintages and a publication-date field, then validate on a newly accumulated holdout.

### liquidity-median

Hypothesis: A point-in-time liquidity composite shifts the log median while leaving the baseline interval scale unchanged.

Formula: `log(median_candidate) = log(median_powerlaw) + coefficient * liquidityComposite.`

Verdict: `context-only` — The numerical promotion gate failed: 14d mean NLL improvement is not positive; 14d daily block-bootstrap one-sided lower95 is not positive; 14d Holm-adjusted p-value is not below 0.05; 14d horizon-spaced robustness failed; 14d candidate forecast outputs are identical to baseline; 30d mean NLL improvement is not positive; 30d daily block-bootstrap one-sided lower95 is not positive; 30d Holm-adjusted p-value is not below 0.05; 30d horizon-spaced robustness failed; 30d candidate forecast outputs are identical to baseline; 60d mean NLL improvement is not positive; 60d daily block-bootstrap one-sided lower95 is not positive; 60d Holm-adjusted p-value is not below 0.05; 60d horizon-spaced robustness failed; 60d candidate forecast outputs are identical to baseline; 90d mean NLL improvement is not positive; 90d daily block-bootstrap one-sided lower95 is not positive; 90d Holm-adjusted p-value is not below 0.05. Keep the signal context-only.

- Rerun only after an ALFRED/vintage-safe cache, a pre-registered split, and the same untouched-holdout gate.
- Next better experiment: rerun this arm with historical vintages and a publication-date field, then validate on a newly accumulated holdout.

### shock-interval

Hypothesis: A positive 30-day shock in the point-in-time stress composite widens the interval without moving the median.

Formula: `sigma_candidate = sigma_powerlaw * (1 + multiplier * I(stressShockZ30d >= 1)); median unchanged.`

Verdict: `context-only` — The numerical promotion gate failed: 14d mean NLL improvement is not positive; 14d daily block-bootstrap one-sided lower95 is not positive; 14d Holm-adjusted p-value is not below 0.05; 14d horizon-spaced robustness failed; 30d mean NLL improvement is not positive; 30d daily block-bootstrap one-sided lower95 is not positive; 30d Holm-adjusted p-value is not below 0.05; 30d horizon-spaced robustness failed; 30d candidate forecast outputs are identical to baseline; 60d mean NLL improvement is not positive; 60d daily block-bootstrap one-sided lower95 is not positive; 60d Holm-adjusted p-value is not below 0.05; 60d horizon-spaced robustness failed; 60d candidate forecast outputs are identical to baseline; 90d mean NLL improvement is not positive; 90d daily block-bootstrap one-sided lower95 is not positive; 90d Holm-adjusted p-value is not below 0.05; 90d horizon-spaced robustness failed. Keep the signal context-only.

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
