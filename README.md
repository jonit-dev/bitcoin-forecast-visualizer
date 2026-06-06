<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/d6dd78f9-8412-4bd7-bf1b-76dad78f86de

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key.
3. Refresh the cached market data:
   `npm run update:market-data`
4. Run the S&P 500 statistical relevance gate:
   `npm run backtest:market`
5. Run the app:
   `npm run dev`

## Market Tabs

The app defaults to the `BTC` tab and preserves the Bitcoin power-law forecast workspace. The `S&P 500` tab uses VOO as an investable S&P 500 proxy because it has daily OHLCV and volume data; VTI is deferred as a broader-market option.

VOO data lives in `src/data/voo-history.json` and is regenerated with `npm run update:market-data`. The updater uses Yahoo Finance's no-key chart endpoint and normalizes OHLC values with the adjusted-close ratio when the source provides adjusted close.

The S&P 500 forecast uses a statistical log-return model:

```text
equity_premium = clamp(expanding mean daily log return, 0.00005, 0.00055)
drift = equity_premium - 0.25 * mean(r_90) + 0.25 * mean(r_252) + 0.10 * trend_252
volatility = 0.65 * stdev(r_90) + 0.35 * stdev(r_252)
median_h = close * exp(drift * h)
interval_h = median_h * exp(+/- z * volatility * sqrt(h))
```

`npm run backtest:market` is the reproducible statistical gate for the S&P 500 model. On the current VOO cache through 2026-06-05, the walk-forward test passes at 30, 90, and 180 trading-day horizons with statistically significant median-error improvement versus a no-change baseline and directional relevance against a 50% null.
