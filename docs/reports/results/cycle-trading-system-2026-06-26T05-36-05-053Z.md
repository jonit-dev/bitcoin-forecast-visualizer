# BTC cycle-zone trading-system sweep

Generated: 2026-06-26T05:36:05.053Z

Initial capital: $1,000. Fee assumption: 0.10% per trade. Trades execute on next-day open after a prior-day signal.

## Important leakage note

The visible chart's orange Trim zone is the 30 days before an ATH marker. Historical known ATH/ATL markers are not tradable if they were identified after the fact, so `visible-oracle` is reported only as an upper-bound/reference. The `scheduled` variant uses the fixed 1064d ATL→ATH and 364d ATH→ATL cadence seeded from the 2015-01-14 ATL.

Buy signal uses the existing leakage-safe heavy-buy score. Trim signal uses the main-chart Trim band.

Buy-and-hold from 2015-01-14 to 2026-06-25: $269,905 (+26891% total, +63.1% CAGR, -83.3% max DD).

## Best causal scheduled systems

| strategy | final | return | CAGR | max DD | trades | win | fees |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `scheduled-base-hold-buy0.7-trim0.5-base0.35` | $29,685 | +2868% | +34.5% | -44.9% | 77 | n/a | $170 |
| `scheduled-base-hold-buy0.65-trim0.5-base0.35` | $27,224 | +2622% | +33.5% | -47.6% | 57 | n/a | $136 |
| `scheduled-base-hold-buy0.75-trim0.5-base0.35` | $25,427 | +2443% | +32.7% | -42.8% | 71 | n/a | $99 |
| `scheduled-base-hold-buy0.7-trim0.3-base0.35` | $23,759 | +2276% | +31.9% | -44.6% | 71 | n/a | $124 |
| `scheduled-base-hold-buy0.65-trim0.3-base0.35` | $21,399 | +2040% | +30.7% | -47.4% | 50 | n/a | $94 |
| `scheduled-base-hold-buy0.75-trim0.3-base0.35` | $20,407 | +1941% | +30.2% | -42.9% | 68 | n/a | $72 |
| `scheduled-base-hold-buy0.7-trim0.15-base0.35` | $19,684 | +1868% | +29.7% | -44.9% | 76 | n/a | $123 |
| `scheduled-base-hold-buy0.65-trim0.15-base0.35` | $18,055 | +1705% | +28.8% | -47.6% | 56 | n/a | $97 |
| `scheduled-base-hold-buy0.7-trim0.5-base0.2` | $16,903 | +1590% | +28.0% | -29.7% | 69 | n/a | $149 |
| `scheduled-base-hold-buy0.75-trim0.15-base0.35` | $16,799 | +1580% | +28.0% | -42.8% | 70 | n/a | $77 |
| `scheduled-base-hold-buy0.7-trim0-base0.35` | $15,860 | +1486% | +27.3% | -44.9% | 75 | +100.0% | $114 |
| `scheduled-base-hold-buy0.65-trim0-base0.35` | $14,547 | +1355% | +26.4% | -47.6% | 55 | +100.0% | $92 |

## Visible/oracle reference

| strategy | final | return | CAGR | max DD | trades | win | fees |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `visible-oracle-base-hold-buy0.7-trim0.5-base0.35` | $30,361 | +2936% | +34.7% | -41.0% | 78 | n/a | $174 |
| `visible-oracle-base-hold-buy0.65-trim0.5-base0.35` | $28,499 | +2750% | +34.0% | -44.4% | 59 | n/a | $144 |
| `visible-oracle-base-hold-buy0.75-trim0.5-base0.35` | $25,688 | +2469% | +32.8% | -39.6% | 72 | n/a | $101 |
| `visible-oracle-base-hold-buy0.7-trim0.3-base0.35` | $23,768 | +2277% | +31.9% | -44.6% | 71 | n/a | $124 |
| `visible-oracle-base-hold-buy0.65-trim0.3-base0.35` | $21,399 | +2040% | +30.7% | -47.4% | 50 | n/a | $94 |
| `visible-oracle-base-hold-buy0.7-trim0.15-base0.35` | $21,311 | +2031% | +30.6% | -40.7% | 79 | n/a | $134 |
| `visible-oracle-base-hold-buy0.75-trim0.3-base0.35` | $20,415 | +1941% | +30.2% | -42.9% | 68 | n/a | $72 |
| `visible-oracle-base-hold-buy0.65-trim0.15-base0.35` | $19,289 | +1829% | +29.5% | -44.1% | 58 | n/a | $105 |
| `visible-oracle-base-hold-buy0.75-trim0.15-base0.35` | $17,965 | +1697% | +28.7% | -39.2% | 73 | n/a | $84 |
| `visible-oracle-base-hold-buy0.7-trim0-base0.35` | $17,126 | +1613% | +28.2% | -41.1% | 78 | +100.0% | $124 |
| `visible-oracle-base-hold-buy0.7-trim0.5-base0.2` | $16,825 | +1582% | +28.0% | -29.0% | 69 | n/a | $149 |
| `visible-oracle-base-hold-buy0.65-trim0-base0.35` | $15,501 | +1450% | +27.1% | -44.4% | 57 | +100.0% | $99 |

## Proposed robust rule

Prefer scheduled, ladder/risk-scaled systems over all-in systems unless the goal is pure upside. A robust live rule should accumulate in steps when bottomScore crosses 0.70/0.75, keep some cash reserve, and trim to 15-30% BTC exposure in scheduled Trim windows instead of going fully flat.
