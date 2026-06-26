# BTC Market Data Quality And Volume Audit

Generated: 2026-06-26T04:57:51.659Z

## Setup

- Canonical cache: src/data/btc-history.json
- Canonical latest date: 2026-06-18
- Audit window: 2025-06-19 through 2026-06-18
- Purpose: Data-quality audit before any exchange-volume forecast experiment.
- Promotion policy: This audit cannot promote a forecast feature. It can only document whether exchange candles are stable enough to support a separate pre-registered volume-feature ablation.

## Verdict

- Status: **needs-review**
- Summary: At least one source is available, but close/volume agreement is not strong enough to treat exchange volume as model-ready without manual review.

## Source summary

### Binance spot BTCUSDT 1d klines

- Status: available
- Rows: 365, first=2025-06-19, latest=2026-06-18, overlap=365, missing=0
- Close diff: median=0.18%, p95=0.81%, max=1.95%, >1%=12, >5%=0
- OHLC violations: 0
- Volume: correlation=0.5101, median ratio=0.0348, p95 ratio=0.0765
- Note: BTCUSDT is a USDT quote market, not BTC/USD spot; close agreement is useful but not a canonical USD replacement by itself.
- Note: Volume is quote volume in USDT and is not directly comparable to CoinGecko aggregate USD volume.

### Coinbase Exchange BTC-USD 1d candles

- Status: available
- Rows: 366, first=2025-06-19, latest=2026-06-19, overlap=365, missing=0
- Close diff: median=0.16%, p95=0.79%, max=1.96%, >1%=13, >5%=0
- OHLC violations: 0
- Volume: correlation=0.4478, median ratio=0.0148, p95 ratio=0.0350
- Note: Coinbase is BTC/USD spot with exchange-specific base BTC volume converted to approximate USD using daily close; it is useful for source-methodology drift checks but not total market volume.

### Kraken XBT/USD 1d OHLC

- Status: available
- Rows: 373, first=2025-06-19, latest=2026-06-26, overlap=365, missing=0
- Close diff: median=0.16%, p95=0.80%, max=1.97%, >1%=10, >5%=0
- OHLC violations: 0
- Volume: correlation=0.4141, median ratio=0.0034, p95 ratio=0.0080
- Note: Kraken is BTC/USD spot with exchange-specific base BTC volume converted to approximate USD using daily close and may return a limited recent history window.

