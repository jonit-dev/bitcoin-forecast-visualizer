# Predictive Distribution Family Report

Status: report-only; no runtime Student-t promotion is performed by this script.

## Provenance

- Generated: 2026-08-02T23:35:46.064Z
- Git commit: `d64644a1d203bc884d62e20d80c51d1380636a01`
- Working tree dirty at generation start: no
- Source tree dirty at generation start: no
- Dataset: 2010-07-17 through 2026-07-15 (5843 rows)
- Dataset SHA-256: `c347fddeffe98b42864ae6b5f9676c7c04d2b3be9de7cab317b366f7381c1ae0`

## Protocol

- Fit window: 2017-01-01 through 2021-12-31; target must end by fit end
- Validation window: 2022-01-01 onward
- Horizons: 14, 30, 60, 90 days
- Exact nu grid: 3, 4, 5, 6, 8, 10, 15, 20, 30, Infinity
- Selection: fit-window CRPS; validation scored after selection
- Bootstrap: 4000 moving-block iterations with block length equal to horizon
- Multiplicity: Holm correction across the four gated horizons at alpha=0.05

## Infinity self-check

- Passed: yes
| Horizon | Samples | CRPS difference | Exact metric match |
| ---: | ---: | ---: | --- |
| 14 | 1643 | 0.00000000 | yes |
| 30 | 1627 | 0.00000000 | yes |
| 60 | 1597 | 0.00000000 | yes |
| 90 | 1567 | 0.00000000 | yes |

## Candidate grid CRPS

| Horizon | nu | Fit CRPS | Validation CRPS |
| ---: | ---: | ---: | ---: |
| 14 | 3 | 1233.08190510 | 2517.33600804 |
| 14 | 4 | 1222.10194531 | 2510.83139770 |
| 14 | 5 | 1219.97565258 | 2514.88876434 |
| 14 | 6 | 1219.23102225 | 2518.25458272 |
| 14 | 8 | 1218.75676990 | 2522.48730610 |
| 14 | 10 | 1218.65873646 | 2524.99603674 |
| 14 | 15 | 1218.71105242 | 2528.11631487 |
| 14 | 20 | 1218.78997167 | 2529.55812665 |
| 14 | 30 | 1218.91385060 | 2530.91491843 |
| 14 | Infinity | 1219.28671011 | 2533.40793280 |
| 30 | 3 | 1877.66302964 | 3672.05196627 |
| 30 | 4 | 1843.52825456 | 3631.10371046 |
| 30 | 5 | 1833.40513100 | 3623.69870876 |
| 30 | 6 | 1829.14517931 | 3621.57129355 |
| 30 | 8 | 1825.56958989 | 3620.40766140 |
| 30 | 10 | 1823.98325128 | 3620.29218965 |
| 30 | 15 | 1822.28684238 | 3620.65792799 |
| 30 | 20 | 1821.64228484 | 3621.03221453 |
| 30 | 30 | 1821.08370448 | 3621.46047351 |
| 30 | Infinity | 1820.21878134 | 3622.57328718 |
| 60 | 3 | 2886.97917252 | 4951.85169427 |
| 60 | 4 | 2808.71854565 | 4879.08698031 |
| 60 | 5 | 2782.93595289 | 4863.05822888 |
| 60 | 6 | 2770.87351590 | 4857.72952153 |
| 60 | 8 | 2759.71888325 | 4855.17212387 |
| 60 | 10 | 2754.60036699 | 4854.89114724 |
| 60 | 15 | 2749.17386327 | 4855.48098415 |
| 60 | 20 | 2746.90263351 | 4856.10402377 |
| 60 | 30 | 2744.85963583 | 4856.86203658 |
| 60 | Infinity | 2741.43718477 | 4858.52263036 |
| 90 | 3 | 3744.60636996 | 5609.07200353 |
| 90 | 4 | 3637.01457131 | 5482.83557392 |
| 90 | 5 | 3599.42711981 | 5450.45581119 |
| 90 | 6 | 3580.49648984 | 5438.57412266 |
| 90 | 8 | 3561.99946785 | 5429.04223482 |
| 90 | 10 | 3552.97606587 | 5425.25360373 |
| 90 | 15 | 3543.05011939 | 5422.13894911 |
| 90 | 20 | 3538.84337888 | 5421.46642932 |
| 90 | 30 | 3535.05026744 | 5421.00128194 |
| 90 | Infinity | 3528.63172760 | 5420.69420903 |

## Baseline versus selected Student-t on validation

| Horizon | Fit nu | Validation-selected nu | CRPS baseline | CRPS candidate | Winkler 80/90/95 baseline | Winkler 80/90/95 candidate | PIT chi-square baseline/candidate | Coverage 80/90/95 baseline | Coverage 80/90/95 candidate | Median abs-log baseline/candidate |
| ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
14 | 10 | 4 | 2533.40793280 | 2524.99603674 | 19051.60425850 / 23479.05835088 / 27610.58670694 | 18873.42917189 / 23438.96922706 / 27604.79764878 | 73.76810712 / 37.31040779 | 84.0% / 90.0% / 93.4% | 83.4% / 89.5% / 93.8% | 0.05266441 / 0.05266441 | |
30 | Infinity | 10 | 3622.57328718 | 3622.57328718 | 26538.53492382 / 31613.28837032 / 36188.35565137 | 26538.53492382 / 31613.28837032 / 36188.35565137 | 37.43146896 / 37.43146896 | 79.6% / 90.0% / 94.7% | 79.6% / 90.0% / 94.7% | 0.08374708 / 0.08374708 | |
60 | Infinity | 10 | 4858.52263036 | 4858.52263036 | 32207.92806941 / 37326.39862279 / 42507.63951481 | 32207.92806941 / 37326.39862279 / 42507.63951481 | 42.69317470 / 42.69317470 | 79.8% / 93.2% / 98.0% | 79.8% / 93.2% / 98.0% | 0.13928360 / 0.13928360 | |
90 | Infinity | Infinity | 5420.69420903 | 5420.69420903 | 34541.39026330 / 39341.29115103 / 44740.22036836 | 34541.39026330 / 39341.29115103 / 44740.22036836 | 126.35673261 / 126.35673261 | 77.0% / 90.7% / 95.9% | 77.0% / 90.7% / 95.9% | 0.15347419 / 0.15347419 | |

PIT histograms (counts; expected counts are uniform across the reported bins):

- 14d baseline: 144,122,165,201,226,201,179,154,132,119 / expected 164.3,164.3,164.3,164.3,164.3,164.3,164.3,164.3,164.3,164.3; selected candidate: 150,136,176,184,212,184,167,155,157,122 / expected 164.3,164.3,164.3,164.3,164.3,164.3,164.3,164.3,164.3,164.3
- 30d baseline: 188,133,177,153,183,202,179,129,139,144 / expected 162.7,162.7,162.7,162.7,162.7,162.7,162.7,162.7,162.7,162.7; selected candidate: 188,133,177,153,183,202,179,129,139,144 / expected 162.7,162.7,162.7,162.7,162.7,162.7,162.7,162.7,162.7,162.7
- 60d baseline: 172,215,184,142,110,163,150,155,156,150 / expected 159.7,159.7,159.7,159.7,159.7,159.7,159.7,159.7,159.7,159.7; selected candidate: 172,215,184,142,110,163,150,155,156,150 / expected 159.7,159.7,159.7,159.7,159.7,159.7,159.7,159.7,159.7,159.7
- 90d baseline: 216,220,128,152,139,93,96,165,213,145 / expected 156.7,156.7,156.7,156.7,156.7,156.7,156.7,156.7,156.7,156.7; selected candidate: 216,220,128,152,139,93,96,165,213,145 / expected 156.7,156.7,156.7,156.7,156.7,156.7,156.7,156.7,156.7,156.7

## Promotion gate

Status: **FAIL**

- 14d: FAIL; gates={"crps":true,"coverage":true,"pit":true,"median":true,"stability":false}; fit nu=10; validation-selected nu=4; Holm p=0.02399400; corrected lower bound=0.84638214; block length=14
- 30d: FAIL; gates={"crps":false,"coverage":true,"pit":false,"median":true,"stability":false}; fit nu=Infinity; validation-selected nu=10; Holm p=1.00000000; corrected lower bound=0.00000000; block length=30
- 60d: FAIL; gates={"crps":false,"coverage":true,"pit":false,"median":true,"stability":false}; fit nu=Infinity; validation-selected nu=10; Holm p=1.00000000; corrected lower bound=0.00000000; block length=60
- 90d: FAIL; gates={"crps":false,"coverage":true,"pit":false,"median":true,"stability":true}; fit nu=Infinity; validation-selected nu=Infinity; Holm p=1.00000000; corrected lower bound=0.00000000; block length=90

Exact pre-registered gate:

`DISTRIBUTION_CONFIG.defaultEnabled` may flip to `true` only if, at **every** one of 14/30/60/90d:

1. Validation CRPS improves versus log-normal, with a positive block-bootstrap 5% lower bound after Holm correction across the four horizons;
2. 80% coverage moves toward nominal and 95% coverage does not move away from it;
3. PIT uniformity improves (lower chi-square statistic);
4. Median absolute log error is **identical** to the baseline — any movement means the median was touched, which is out of scope and voids the run;
5. The selected `nu` is within a factor of two between the fit and validation windows. Instability here is the ledger's most common failure signature (tau=120, close-sma200, MACD all reversed sign across subperiods) and must block promotion rather than be argued around.

Verdict: Report-only: at least one pre-registered gate failed at one or more gated horizons; keep the Student-t candidate disabled and register the empirical-shape follow-up.
