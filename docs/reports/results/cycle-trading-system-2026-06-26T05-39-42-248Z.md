# BTC cycle-zone trading-system sweep

Generated: 2026-06-26T05:39:42.248Z

Initial capital: $1,000. Fee assumption: 0.10% per trade. Borrow APR for leveraged variants: 8.0%. Maintenance margin tripwire: 15%. Trades execute on next-day open after a prior-day signal.

## Important leakage note

The visible chart's orange Trim zone is the 30 days before an ATH marker. Historical known ATH/ATL markers are not tradable if they were identified after the fact, so `visible-oracle` is reported only as an upper-bound/reference. The `scheduled` variant uses the fixed 1064d ATL→ATH and 364d ATH→ATL cadence seeded from the 2015-01-14 ATL.

Buy signal uses the existing leakage-safe heavy-buy score. Trim signal uses the main-chart Trim band.

Buy-and-hold from 2015-01-14 to 2026-06-25: $269,905 (+26891% total, +63.1% CAGR, -83.3% max DD).

## Best causal scheduled systems

| strategy | final | return | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `scheduled-stateful-risk-buy0.7-trim0.5-base0-L2` | $144,120,251 | +14411925% | +182.3% | -83.3% | +128.7% | 277 | no | $7,667,314 |
| `scheduled-stateful-risk-buy0.65-trim0.5-base0-L2` | $127,860,071 | +12785907% | +179.4% | -88.2% | +138.2% | 375 | no | $9,039,818 |
| `scheduled-stateful-risk-buy0.7-trim0.3-base0-L2` | $114,285,089 | +11428409% | +176.7% | -83.3% | +128.3% | 277 | no | $6,209,364 |
| `scheduled-stateful-risk-buy0.65-trim0.3-base0-L2` | $101,390,292 | +10138929% | +173.8% | -88.2% | +137.7% | 375 | no | $7,321,075 |
| `scheduled-stateful-risk-buy0.7-trim0.15-base0-L2` | $95,550,393 | +9554939% | +172.4% | -83.3% | +128.0% | 276 | no | $5,275,794 |
| `scheduled-stateful-risk-buy0.65-trim0.15-base0-L2` | $84,768,956 | +8476796% | +169.5% | -88.2% | +137.4% | 374 | no | $6,220,465 |
| `scheduled-stateful-ladder-buy0.7-trim0.5-base0-L2` | $82,692,598 | +8269160% | +169.0% | -71.1% | +113.2% | 208 | no | $2,204,593 |
| `scheduled-stateful-risk-buy0.7-trim0-base0-L2` | $77,032,942 | +7703194% | +167.3% | -83.3% | +127.6% | 272 | no | $4,323,919 |
| `scheduled-stateful-risk-buy0.65-trim0-base0-L2` | $68,340,524 | +6833952% | +164.5% | -88.2% | +137.0% | 370 | no | $5,098,196 |
| `scheduled-stateful-ladder-buy0.7-trim0.3-base0-L2` | $65,574,759 | +6557376% | +163.6% | -71.1% | +112.8% | 208 | no | $1,786,486 |
| `scheduled-stateful-ladder-buy0.7-trim0.15-base0-L2` | $54,825,665 | +5482467% | +159.5% | -71.1% | +112.4% | 207 | no | $1,518,711 |
| `scheduled-stateful-ladder-buy0.65-trim0.5-base0-L2` | $50,980,762 | +5097976% | +157.8% | -73.8% | +116.5% | 213 | no | $1,449,959 |

## Best Risk-Adjusted Causal Systems

Score is CAGR divided by absolute max drawdown; this favors systems that survive cleanly.

| strategy | final | CAGR | max DD | score | avg exposure | borrow cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `scheduled-stateful-ladder-buy0.7-trim0.5-base0-L2` | $82,692,598 | +169.0% | -71.1% | 2.38 | +113.2% | $2,204,593 |
| `scheduled-stateful-ladder-buy0.7-trim0.3-base0-L2` | $65,574,759 | +163.6% | -71.1% | 2.30 | +112.8% | $1,786,486 |
| `scheduled-stateful-ladder-buy0.7-trim0.15-base0-L2` | $54,825,665 | +159.5% | -71.1% | 2.24 | +112.4% | $1,518,711 |
| `scheduled-stateful-risk-buy0.7-trim0.5-base0-L2` | $144,120,251 | +182.3% | -83.3% | 2.19 | +128.7% | $7,667,314 |
| `scheduled-stateful-risk-buy0.75-trim0.5-base0-L1` | $123,404 | +52.3% | -24.0% | 2.18 | +32.5% | $0 |
| `scheduled-stateful-ladder-buy0.75-trim0.5-base0-L1.25` | $1,875,265 | +93.2% | -42.8% | 2.18 | +56.8% | $442 |
| `scheduled-stateful-ladder-buy0.75-trim0.5-base0-L1.5` | $1,875,265 | +93.2% | -42.8% | 2.18 | +56.8% | $442 |
| `scheduled-stateful-ladder-buy0.75-trim0.5-base0-L2` | $1,875,265 | +93.2% | -42.8% | 2.18 | +56.8% | $442 |
| `scheduled-stateful-ladder-buy0.7-trim0-base0-L2` | $44,201,027 | +154.6% | -71.1% | 2.18 | +112.1% | $1,245,600 |
| `scheduled-stateful-ladder-buy0.7-trim0.5-base0-L1.5` | $39,547,787 | +152.2% | -71.1% | 2.14 | +100.7% | $1,053,274 |
| `scheduled-stateful-ladder-buy0.65-trim0.5-base0-L2` | $50,980,762 | +157.8% | -73.8% | 2.14 | +116.5% | $1,449,959 |
| `scheduled-stateful-risk-buy0.7-trim0.3-base0-L2` | $114,285,089 | +176.7% | -83.3% | 2.12 | +128.3% | $6,209,364 |

## Visible/oracle reference

| strategy | final | return | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `visible-oracle-stateful-risk-buy0.7-trim0.5-base0-L2` | $193,767,170 | +19376617% | +189.7% | -83.3% | +128.9% | 280 | no | $10,306,870 |
| `visible-oracle-stateful-risk-buy0.65-trim0.5-base0-L2` | $171,905,641 | +17190464% | +186.7% | -88.2% | +138.4% | 378 | no | $12,152,121 |
| `visible-oracle-stateful-risk-buy0.7-trim0.3-base0-L2` | $155,635,972 | +15563497% | +184.2% | -83.3% | +128.5% | 279 | no | $8,454,252 |
| `visible-oracle-stateful-risk-buy0.65-trim0.3-base0-L2` | $138,075,551 | +13807455% | +181.3% | -88.2% | +137.9% | 377 | no | $9,968,142 |
| `visible-oracle-stateful-risk-buy0.7-trim0.15-base0-L2` | $131,124,323 | +13112332% | +180.0% | -83.3% | +128.1% | 279 | no | $7,238,142 |
| `visible-oracle-stateful-risk-buy0.65-trim0.15-base0-L2` | $116,328,898 | +11632790% | +177.1% | -88.2% | +137.6% | 377 | no | $8,534,456 |
| `visible-oracle-stateful-ladder-buy0.7-trim0.5-base0-L2` | $111,178,759 | +11117776% | +176.0% | -71.1% | +113.4% | 211 | no | $2,962,410 |
| `visible-oracle-stateful-risk-buy0.7-trim0-base0-L2` | $105,431,339 | +10543034% | +174.7% | -83.3% | +127.8% | 275 | no | $5,916,106 |
| `visible-oracle-stateful-risk-buy0.65-trim0-base0-L2` | $93,534,438 | +9353344% | +171.9% | -88.2% | +137.2% | 373 | no | $6,975,759 |
| `visible-oracle-stateful-ladder-buy0.7-trim0.3-base0-L2` | $89,301,163 | +8930016% | +170.8% | -71.1% | +112.9% | 210 | no | $2,431,155 |
| `visible-oracle-stateful-ladder-buy0.7-trim0.15-base0-L2` | $75,237,558 | +7523656% | +166.8% | -71.1% | +112.6% | 210 | no | $2,082,357 |
| `visible-oracle-stateful-ladder-buy0.65-trim0.5-base0-L2` | $68,542,747 | +6854175% | +164.6% | -73.8% | +116.6% | 216 | no | $1,947,818 |

## Proposed robust rule

Prefer scheduled, stateful ladder/risk-scaled systems over all-in systems unless the goal is pure upside. A robust live rule should accumulate in steps when bottomScore crosses 0.70/0.75, use no more than modest leverage unless fresh walk-forward tests justify it, and trim to 15-30% BTC exposure in scheduled Trim windows instead of going fully flat.
