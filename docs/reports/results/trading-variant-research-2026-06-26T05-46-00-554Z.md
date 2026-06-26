# BTC trading variant research

Generated: 2026-06-26T05:46:00.554Z

Buy-and-hold benchmark: $269,905 (+63.1% CAGR, -83.3% max DD).

All variants are causal: prior-day features, scheduled cycle Trim windows, next-day open execution, 0.10% fee, 8.0% borrow APR, intraday low liquidation tripwire.

## Safe Candidates That Beat Buy-And-Hold

| strategy | final | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |


## Top By Ending Value

| strategy | final | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `stateful-value-buy0.7-trim0-L1.5` | $8,353,938 | +120.1% | -66.9% | +90.1% | 39 | no | $92,458 |
| `liquidity-boost-buy0.7-trim0-L1.5` | $8,353,938 | +120.1% | -66.9% | +90.1% | 39 | no | $92,458 |
| `stateful-value-buy0.68-trim0-L1.5` | $7,903,861 | +119.1% | -69.8% | +93.4% | 49 | no | $145,420 |
| `liquidity-boost-buy0.68-trim0-L1.5` | $7,903,861 | +119.1% | -69.8% | +93.4% | 49 | no | $145,420 |
| `stateful-value-buy0.75-trim0-L1.5` | $7,085,364 | +117.0% | -61.2% | +78.7% | 15 | no | $487 |
| `liquidity-boost-buy0.75-trim0-L1.5` | $7,085,364 | +117.0% | -61.2% | +78.7% | 15 | no | $487 |
| `stateful-value-buy0.72-trim0-L1.5` | $6,666,285 | +115.8% | -62.0% | +85.3% | 28 | no | $18,647 |
| `liquidity-boost-buy0.72-trim0-L1.5` | $6,666,285 | +115.8% | -62.0% | +85.3% | 28 | no | $18,647 |
| `stateful-value-buy0.7-trim0.25-L1.5` | $5,989,194 | +113.8% | -66.9% | +94.8% | 44 | no | $76,796 |
| `liquidity-boost-buy0.7-trim0.25-L1.5` | $5,989,194 | +113.8% | -66.9% | +94.8% | 44 | no | $76,796 |
| `stateful-value-buy0.68-trim0.25-L1.5` | $5,936,769 | +113.7% | -69.8% | +98.1% | 54 | no | $126,330 |
| `liquidity-boost-buy0.68-trim0.25-L1.5` | $5,936,769 | +113.7% | -69.8% | +98.1% | 54 | no | $126,330 |
| `stateful-value-buy0.68-trim0-L1.35` | $5,197,991 | +111.2% | -62.8% | +84.2% | 20 | no | $18,050 |
| `liquidity-boost-buy0.68-trim0-L1.35` | $5,197,991 | +111.2% | -62.8% | +84.2% | 20 | no | $18,050 |
| `stateful-value-buy0.7-trim0-L1.35` | $5,175,561 | +111.1% | -62.0% | +82.9% | 19 | no | $10,901 |

## Top Risk-Adjusted

| strategy | final | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `stateful-value-buy0.75-trim0-L1.5` | $7,085,364 | +117.0% | -61.2% | +78.7% | 15 | no | $487 |
| `liquidity-boost-buy0.75-trim0-L1.5` | $7,085,364 | +117.0% | -61.2% | +78.7% | 15 | no | $487 |
| `stateful-value-buy0.72-trim0-L1.5` | $6,666,285 | +115.8% | -62.0% | +85.3% | 28 | no | $18,647 |
| `liquidity-boost-buy0.72-trim0-L1.5` | $6,666,285 | +115.8% | -62.0% | +85.3% | 28 | no | $18,647 |
| `stateful-value-buy0.75-trim0-L1.35` | $4,279,161 | +107.6% | -58.8% | +74.5% | 10 | no | $189 |
| `liquidity-boost-buy0.75-trim0-L1.35` | $4,279,161 | +107.6% | -58.8% | +74.5% | 10 | no | $189 |
| `stateful-value-buy0.75-trim0-L1` | $2,037,931 | +94.6% | -52.3% | +65.0% | 12 | no | $0 |
| `liquidity-boost-buy0.75-trim0-L1` | $2,037,931 | +94.6% | -52.3% | +65.0% | 12 | no | $0 |
| `stateful-value-buy0.72-trim0-L1.35` | $4,865,954 | +110.0% | -61.1% | +81.2% | 15 | no | $1,691 |
| `liquidity-boost-buy0.72-trim0-L1.35` | $4,865,954 | +110.0% | -61.1% | +81.2% | 15 | no | $1,691 |
| `stateful-value-buy0.7-trim0-L1.5` | $8,353,938 | +120.1% | -66.9% | +90.1% | 39 | no | $92,458 |
| `liquidity-boost-buy0.7-trim0-L1.5` | $8,353,938 | +120.1% | -66.9% | +90.1% | 39 | no | $92,458 |
| `stateful-value-buy0.75-trim0.25-L1.5` | $4,842,044 | +109.9% | -61.2% | +84.1% | 21 | no | $487 |
| `liquidity-boost-buy0.75-trim0.25-L1.5` | $4,842,044 | +109.9% | -61.2% | +84.1% | 21 | no | $487 |
| `stateful-value-buy0.7-trim0-L1.35` | $5,175,561 | +111.1% | -62.0% | +82.9% | 19 | no | $10,901 |
