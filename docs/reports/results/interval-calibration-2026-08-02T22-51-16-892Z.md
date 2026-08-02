# Disjoint Interval Calibration

Generated: 2026-08-02T22:51:16.892Z
Git commit: `eeb1478aadb22bcc11ecfde1b6e0365683890435`
Working tree dirty at generation start: yes
Source tree dirty at generation start: no
Dataset: 2010-07-17 to 2026-07-15 (5843 rows)
Dataset SHA-256: `c347fddeffe98b42864ae6b5f9676c7c04d2b3be9de7cab317b366f7381c1ae0`
Fit window: 2017-01-01 to 2021-12-31
Validation window: 2022-01-01 onward
Divergence tolerance: 0.05
Status: **DIVERGENT**

Validation coverage is scored on a disjoint window. DIVERGENT rows never contribute a suggested shipped multiplier. Approximate CRPS uses the sparse quantile grid and endpoint-constant tails described in metadata; Winkler is an absolute price-scale score. PIT is not used for multiplier fitting.
CRPS: Approximate CRPS (sparse quantile grid; endpoint-constant tails). Method: quantile pinball integral identity with trapezoidal quadrature. Grid: q025, q05, q10, q50, q90, q95, q975. Tail convention: Endpoint-constant extension over the full probability domain: Q(p) equals the first supplied quantile below the first grid probability and the last supplied quantile above the last grid probability.
CRPS approximation error: A numeric approximation-error bound is not estimable from this sparse quantile grid and endpoint-tail assumption.

| Horizon | Status | Multiplier | Fit n | Validation n | Fit 80/90/95 | Validation 80/90/95 | Fit Approx CRPS | Validation Approx CRPS | Fit Winkler 80/90/95 | Validation Winkler 80/90/95 |
| ---: | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | --- | --- |
| 14d | DIVERGENT | 1.11 | 1826 | 1643 | 83.3% / 90.0% / 93.8% | 86.1% / 92.3% / 95.3% | 1232.43356 | 2556.08664 | 9370.10975 / 11548.80244 / 13632.24982 | 19535.64411 / 23966.65758 / 27817.25788 | |
| 30d | DIVERGENT | 1.17 | 1826 | 1627 | 80.8% / 89.8% / 93.3% | 87.0% / 94.7% / 97.7% | 1844.11133 | 3675.77949 | 13632.04623 / 16779.43820 / 20200.35433 | 27579.69300 / 33250.02473 / 38282.12412 | |
| 60d | DIVERGENT | 1.34 | 1826 | 1597 | 81.8% / 89.9% / 94.5% | 94.7% / 99.5% / 100.0% | 2810.23036 | 5144.58334 | 19906.52061 / 24928.33425 / 28950.00739 | 37342.49905 / 47333.92098 / 56979.62009 | |
| 90d | DIVERGENT | 1.34 | 1826 | 1567 | 80.1% / 90.0% / 95.5% | 95.9% / 99.8% / 100.0% | 3477.03348 | 5892.17756 | 25270.89062 / 31064.98265 / 35376.75594 | 43098.42469 / 55381.11486 / 66939.14296 | |
| 180d | DIVERGENT | 1.33 | 1826 | 1477 | 80.0% / 89.9% / 95.0% | 94.9% / 99.8% / 100.0% | 4174.01821 | 6384.08125 | 33237.73565 / 41051.92224 / 46640.43599 | 54004.85119 / 68934.52406 / 83800.37162 | |
| 365d | DIVERGENT | 1.18 | 1826 | 1292 | 80.6% / 88.1% / 95.0% | 100.0% / 100.0% / 100.0% | 4456.26924 | 6455.31980 | 31816.72482 / 38344.38900 / 45691.91913 | 56733.66314 / 74218.05855 / 90243.63235 | |

Suggested config: **REFUSED** because at least one horizon failed the disjoint validation gate.

- 14d: interval80 validation/nominal divergence 0.0606 > 0.0500
- 30d: interval80 fit/validation divergence 0.0619 > 0.0500; interval80 validation/nominal divergence 0.0697 > 0.0500
- 60d: interval80 fit/validation divergence 0.1298 > 0.0500; interval80 validation/nominal divergence 0.1474 > 0.0500; interval90 fit/validation divergence 0.0958 > 0.0500; interval90 validation/nominal divergence 0.0950 > 0.0500; interval95 fit/validation divergence 0.0548 > 0.0500; interval95 validation/nominal divergence 0.0500 > 0.0500
- 90d: interval80 fit/validation divergence 0.1585 > 0.0500; interval80 validation/nominal divergence 0.1592 > 0.0500; interval90 fit/validation divergence 0.0983 > 0.0500; interval90 validation/nominal divergence 0.0981 > 0.0500; interval95 validation/nominal divergence 0.0500 > 0.0500
- 180d: interval80 fit/validation divergence 0.1484 > 0.0500; interval80 validation/nominal divergence 0.1485 > 0.0500; interval90 fit/validation divergence 0.0987 > 0.0500; interval90 validation/nominal divergence 0.0980 > 0.0500; interval95 fit/validation divergence 0.0504 > 0.0500; interval95 validation/nominal divergence 0.0500 > 0.0500
- 365d: interval80 fit/validation divergence 0.1944 > 0.0500; interval80 validation/nominal divergence 0.2000 > 0.0500; interval90 fit/validation divergence 0.1194 > 0.0500; interval90 validation/nominal divergence 0.1000 > 0.0500; interval95 fit/validation divergence 0.0504 > 0.0500; interval95 validation/nominal divergence 0.0500 > 0.0500

Validation coverage is reported separately from fit coverage. No multiplier is suggested for a DIVERGENT horizon.
