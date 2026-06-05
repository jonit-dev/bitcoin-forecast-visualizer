# Regime Data Sources

## Required Sources

| Cache | Source | Fields | Cadence | Lag | Credentials |
| --- | --- | --- | --- | --- | --- |
| `src/data/btc-history.json` | CoinGecko hourly market chart, CryptoCompare daily volume | OHLCV | Daily UTC | Usually 0-1 day | None |
| `src/data/mvrv-history.json` | CoinMetrics Community API | `CapMVRVCur`, `CapMrktCurUSD` | Daily UTC | Usually 0-2 days | None |
| `src/data/onchain-history.json` | CoinMetrics Community API | MVRV, market cap, realized cap/price derived from MVRV, active addresses, transaction count, hash rate, fees, issuance/miner revenue proxy | Daily UTC | Usually 0-2 days | None |

`transferValueUSD` and `difficulty` are preserved as missing metrics when unavailable through the community API.

## Optional Sources

| Cache | Status | Methodology | Credentials |
| --- | --- | --- | --- |
| `src/data/derivatives-history.json` | Optional unavailable by default | Open interest and funding require a selected stable historical source. The baseline cache records explicit unavailable metadata. | None configured |
| `src/data/etf-flow-history.json` | Optional unavailable by default | ETF flow vendors differ in methodology and machine-readable availability. The baseline cache records explicit unavailable metadata. | None configured |
| `src/data/macro-history.json` | Optional credentialed | FRED series `WALCL`, `FEDFUNDS`, `DGS10`, `BAMLH0A0HYM2`, and `M2SL`, aligned by last-known observation date. | `FRED_API_KEY` |

Optional sources are context-only until validators show coverage and a later ablation proves forecast value.
