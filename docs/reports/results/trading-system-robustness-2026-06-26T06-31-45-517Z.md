# BTC trading-system robustness report

Generated: 2026-06-26T06:31:45.517Z

Benchmark is buy-and-hold from the same start/end dates, starting with $1,000. All strategy runs use prior-day signals, next-day open execution, 0.10% base fee, and no leverage above 100% BTC.

## Current Committed System

Spec: `confirmed-trend-value-hot14-cool45-break10-reentry30-trim35`

- Full run: $1,770,145 | +92.2% | -42.9% | 29 | $0 vs buy-and-hold $269,905 / +63.1% / -83.3%
- Fee stress: $1,711,606 | +91.7% | -43.1% | 29 | $0 vs buy-and-hold $269,500 / +63.1% / -83.3%
- Split beat / lower-DD rate: +67% / +100%

## Best Robust Candidate

Spec: `confirmed-trend-value-hot14-cool45-break10-reentry30-trim35`

- Full run: $1,770,145 | +92.2% | -42.9% | 29 | $0 vs buy-and-hold $269,905 / +63.1% / -83.3%
- Fee stress: $1,711,606 | +91.7% | -43.1% | 29 | $0 vs buy-and-hold $269,500 / +63.1% / -83.3%
- Split beat / lower-DD rate: +67% / +100%

## Top Robust Candidates

| rank | strategy | score | full final | full CAGR | full DD | trades | borrow | stress final | stress CAGR | stress DD | stress trades | stress borrow | split beat / lower DD |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `confirmed-trend-value-hot14-cool45-break10-reentry30-trim35` | 5.80 | $1,770,145 | +92.2% | -42.9% | 29 | $0 | $1,711,606 | +91.7% | -43.1% | 29 | $0 | +67% / +100% |
| 2 | `tv-f100-s150-v0.65-hot14-cool45-break10-re30-trim0.35` | 5.80 | $1,770,145 | +92.2% | -42.9% | 29 | $0 | $1,711,606 | +91.7% | -43.1% | 29 | $0 | +67% / +100% |
| 3 | `tv-f100-s150-v0.65-hot14-cool60-break10-re30-trim0.35` | 5.80 | $1,770,145 | +92.2% | -42.9% | 29 | $0 | $1,711,606 | +91.7% | -43.1% | 29 | $0 | +67% / +100% |
| 4 | `tv-f100-s150-v0.6-hot14-cool45-break10-re30-trim0.35` | 5.80 | $1,554,159 | +90.1% | -50.7% | 27 | $0 | $1,507,278 | +89.5% | -50.8% | 27 | $0 | +100% / +100% |
| 5 | `tv-f100-s150-v0.6-hot14-cool60-break10-re30-trim0.35` | 5.80 | $1,554,159 | +90.1% | -50.7% | 27 | $0 | $1,507,278 | +89.5% | -50.8% | 27 | $0 | +100% / +100% |
| 6 | `tv-f100-s150-v0.65-hot14-cool45-break5-re30-trim0.35` | 5.73 | $1,718,638 | +91.7% | -43.1% | 32 | $0 | $1,652,446 | +91.1% | -43.2% | 32 | $0 | +67% / +100% |
| 7 | `tv-f100-s150-v0.65-hot14-cool60-break5-re30-trim0.35` | 5.73 | $1,718,638 | +91.7% | -43.1% | 32 | $0 | $1,652,446 | +91.1% | -43.2% | 32 | $0 | +67% / +100% |
| 8 | `tv-f100-s150-v0.6-hot14-cool45-break10-re30-trim0.5` | 5.73 | $1,500,953 | +89.5% | -50.7% | 27 | $0 | $1,455,763 | +89.0% | -50.8% | 27 | $0 | +100% / +100% |
| 9 | `tv-f100-s150-v0.6-hot14-cool60-break10-re30-trim0.5` | 5.73 | $1,500,953 | +89.5% | -50.7% | 27 | $0 | $1,455,763 | +89.0% | -50.8% | 27 | $0 | +100% / +100% |
| 10 | `tv-f100-s150-v0.65-hot14-cool45-break10-re30-trim0.5` | 5.71 | $1,709,545 | +91.6% | -44.6% | 29 | $0 | $1,653,108 | +91.1% | -44.7% | 29 | $0 | +67% / +100% |
| 11 | `tv-f100-s150-v0.65-hot14-cool60-break10-re30-trim0.5` | 5.71 | $1,709,545 | +91.6% | -44.6% | 29 | $0 | $1,653,108 | +91.1% | -44.7% | 29 | $0 | +67% / +100% |
| 12 | `tv-f100-s150-v0.65-hot14-cool45-break10-re30-trim0.65` | 5.68 | $1,728,286 | +91.8% | -49.7% | 29 | $0 | $1,671,100 | +91.3% | -49.9% | 29 | $0 | +67% / +100% |
| 13 | `tv-f100-s150-v0.65-hot14-cool60-break10-re30-trim0.65` | 5.68 | $1,728,286 | +91.8% | -49.7% | 29 | $0 | $1,671,100 | +91.3% | -49.9% | 29 | $0 | +67% / +100% |
| 14 | `tv-f100-s150-v0.65-hot14-cool45-break5-re30-trim0.5` | 5.57 | $1,639,558 | +90.9% | -49.9% | 33 | $0 | $1,576,026 | +90.3% | -50.1% | 33 | $0 | +67% / +100% |
| 15 | `tv-f100-s150-v0.65-hot14-cool60-break5-re30-trim0.5` | 5.57 | $1,639,558 | +90.9% | -49.9% | 33 | $0 | $1,576,026 | +90.3% | -50.1% | 33 | $0 | +67% / +100% |
| 16 | `tv-f100-s150-v0.65-hot7-cool45-break10-re30-trim0.5` | 5.53 | $1,552,058 | +90.0% | -43.6% | 33 | $0 | $1,497,855 | +89.4% | -43.7% | 33 | $0 | +67% / +100% |
| 17 | `tv-f100-s150-v0.65-hot7-cool60-break10-re30-trim0.5` | 5.52 | $1,548,248 | +90.0% | -43.6% | 33 | $0 | $1,494,182 | +89.4% | -43.7% | 33 | $0 | +67% / +100% |
| 18 | `tv-f100-s150-v0.65-hot14-cool45-break5-re10-trim0.35` | 5.49 | $1,536,803 | +89.9% | -44.3% | 38 | $0 | $1,464,375 | +89.1% | -44.7% | 38 | $0 | +67% / +100% |
| 19 | `tv-f100-s150-v0.65-hot14-cool60-break5-re10-trim0.35` | 5.49 | $1,536,803 | +89.9% | -44.3% | 38 | $0 | $1,464,375 | +89.1% | -44.7% | 38 | $0 | +67% / +100% |
| 20 | `tv-f100-s150-v0.65-hot14-cool45-break5-re30-trim0.65` | 5.47 | $1,608,826 | +90.6% | -56.4% | 32 | $0 | $1,546,887 | +90.0% | -56.5% | 32 | $0 | +67% / +100% |

## Best Candidate Splits

| period | system final | system CAGR | system DD | trades | borrow | B&H final | B&H CAGR | B&H DD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2015-2018 | $86,217 | +208.0% | -36.5% | 6 | $0 | $16,917 | +104.2% | -83.3% |
| 2019-2022 | $5,459 | +52.9% | -42.9% | 16 | $0 | $4,407 | +44.9% | -76.7% |
| 2023-latest | $3,607 | +44.6% | -21.2% | 9 | $0 | $3,613 | +44.6% | -52.2% |

## Current System Splits

| period | system final | system CAGR | system DD | trades | borrow | B&H final | B&H CAGR | B&H DD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2015-2018 | $86,217 | +208.0% | -36.5% | 6 | $0 | $16,917 | +104.2% | -83.3% |
| 2019-2022 | $5,459 | +52.9% | -42.9% | 16 | $0 | $4,407 | +44.9% | -76.7% |
| 2023-latest | $3,607 | +44.6% | -21.2% | 9 | $0 | $3,613 | +44.6% | -52.2% |

Interpretation: full-period results are not enough. Prefer candidates that keep the fee-stressed edge and beat buy-and-hold in most period splits while using 0 borrow cost.
