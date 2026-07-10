<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/d6dd78f9-8412-4bd7-bf1b-76dad78f86de

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `yarn install`
2. Create an ignored `.env.local` file for local secrets. Set `GEMINI_API_KEY` there, and use CI/deployment secret storage for hosted environments.
3. Refresh the cached market data:
   `yarn run update:market-data`
4. Run the S&P 500 statistical relevance gate:
   `yarn run backtest:market`
5. Run the app:
   `yarn run dev`

## Programmatic API

Run the local Express API:

```bash
yarn api
```

Endpoints:

- `GET /health` — liveness check.
- `GET /api/assets` — supported forecast assets.
- `GET /api/forecast?asset=btc&horizon=180&confidence=0.95` — compact forecast summary for `btc`, `sp500`, or `gold`.

The API is implemented with lightweight Express decorators in `src/server/decorators.ts`; controllers use `@Controller` and `@Get`.

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

The S&P 500 lower/top lines reuse the same chart fields as BTC floor/peak lines, but use a VOO-specific statistical channel instead of Bitcoin power-law curves:

```text
trend = 126-session SMA
residual = log(close / trend)
lower = trend * exp(2.5th percentile residual over prior 1,260 sessions)
top = trend * exp(99th percentile residual over prior 1,260 sessions)
```

`npm run backtest:market` is the reproducible statistical gate for the S&P 500 model. On the current VOO cache through 2026-06-05, the walk-forward channel test covers 96.3% of sampled closes with 2.4% below-channel breaks and 1.4% above-channel breaks. The median forecast also passes at 30, 90, and 180 trading-day horizons with statistically significant median-error improvement versus a no-change baseline and directional relevance against a 50% null.
# Daily production market quotes

BTC, VOO, and GLD retain checked-in JSON as an immediate read fallback. Production
daily candles are refreshed by `workers/market-quote-refresh` at 23:15 UTC and
stored in D1. Cron changes can take several minutes to propagate.

Create three separate databases (local Wrangler state, preview, and production),
then replace the placeholder IDs in both Wrangler configs. Never point tests or
preview at the production ID. Deploy in this order:

1. `npm run market-quotes:migrate:preview`
2. Deploy the Worker without enabling its cron and invoke a local/preview scheduled
   event twice; inspect `market_candles` and `refresh_runs` for idempotency.
3. Deploy Pages with the D1 binding and verify `/api/market-data` and
   `/api/forecast` return the same latest candle.
4. `npm run market-quotes:deploy:preview`, then enable the production cron only
   after the preview proof passes.

Use `wrangler tail --config workers/market-quote-refresh/wrangler.toml` for Worker
logs and query `refresh_runs` for per-asset outcomes. Run
`MARKET_DATA_BASE_URL=https://preview.example npm run market-quotes:smoke` for the
cross-endpoint freshness check. The independent GitHub watchdog is enabled only
after setting the repository `MARKET_DATA_BASE_URL` variable.

Rollback is non-destructive: disable the Worker cron and remove/disable the Pages
D1 binding/read path. The application then reports `fallback` and continues from
bundled JSON. Do not delete D1 rows during rollback.
