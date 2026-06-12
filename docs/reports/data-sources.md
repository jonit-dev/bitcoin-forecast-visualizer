# Regime Data Sources

## Required Sources

| Cache | Source | Fields | Cadence | Lag | Credentials |
| --- | --- | --- | --- | --- | --- |
| `src/data/btc-history.json` | CoinGecko hourly market chart | OHLCV | Daily UTC | Usually 0-1 day | None |
| `src/data/mvrv-history.json` | CoinMetrics Community API | `CapMVRVCur`, `CapMrktCurUSD` | Daily UTC | Usually 0-2 days | None |
| `src/data/onchain-history.json` | CoinMetrics Community API | MVRV, market cap, realized cap/price derived from MVRV, active addresses, transaction count, hash rate, fees, issuance/miner revenue proxy | Daily UTC | Usually 0-2 days | None |
| `src/data/voo-history.json` | Yahoo Finance chart endpoint | VOO adjusted OHLCV | Trading days | Usually 0-1 trading day | None |

`transferValueUSD` and `difficulty` are preserved as missing metrics when unavailable through the community API.

## Optional Sources

| Cache | Status | Methodology | Credentials |
| --- | --- | --- | --- |
| `src/data/derivatives-history.json` | Optional unavailable by default | Open interest and funding require a selected stable historical source. The baseline cache records explicit unavailable metadata. | None configured |
| `src/data/etf-flow-history.json` | Optional unavailable by default | ETF flow vendors differ in methodology and machine-readable availability. The baseline cache records explicit unavailable metadata. | None configured |
| `src/data/macro-history.json` | Optional credentialed | FRED series `WALCL`, `FEDFUNDS`, `DGS10`, `BAMLH0A0HYM2`, and `M2SL`, aligned by last-known observation date. | `FRED_API_KEY` |

Optional sources are context-only until validators show coverage and a later ablation proves forecast value.

## S&P 500 Proxy And Model

The S&P 500 tab uses VOO, labeled as `S&P 500` in the UI with `VOO ETF, adjusted daily OHLCV` shown as instrument metadata. VOO is used first because it is an investable S&P 500 proxy with real daily OHLCV and volume. VTI is intentionally deferred because it represents the broader U.S. market, not the S&P 500 index.

`npm run update:market-data` refreshes `src/data/voo-history.json`. Yahoo's chart endpoint supplies adjusted close; the updater applies the adjusted-close ratio to open, high, and low so the cached candles are split/dividend adjusted where the source provides adjustment data. If the source is unavailable and a valid cache already exists, the updater reports skipped-update behavior and keeps the cache.

The S&P 500 forecast is a statistical scenario model, not a structural valuation model. It uses an expanding equity-premium prior, a short-term mean-reversion term, a slow 252-session trend term, blended 90/252-session volatility, lognormal intervals, stochastic traces, and probability-up output.

The reproducible validation command is:

```bash
npm run backtest:market
```

Current validation on the VOO cache through 2026-06-05:

| Horizon | Samples | Direction hit rate | Direction p-value | Median-error improvement vs no-change | Paired p-value | 90% coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 trading days | 586 | 69.5% | 2.099e-21 | 10.31% | 3.761e-10 | 90.1% |
| 90 trading days | 574 | 76.3% | 5.637e-38 | 19.56% | 1.170e-12 | 92.2% |
| 180 trading days | 556 | 84.2% | 1.432e-63 | 23.53% | 2.078e-13 | 92.1% |

This proves statistical relevance for the cached VOO backtest window used by the app. It does not guarantee future performance, and the model should be revalidated after material data-source, formula, or market-regime changes.
