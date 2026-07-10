#!/usr/bin/env node
import { countUsMarketSessionsAfter } from '../shared/us-market-calendar.mjs';

const baseUrl = (process.env.MARKET_DATA_BASE_URL || process.argv[2] || '').replace(/\/$/, '');
if (!baseUrl) throw new Error('Set MARKET_DATA_BASE_URL or pass the deployment URL');

const thresholds = { btc: 2, sp500: 3, gold: 3 };
const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
let failed = false;

for (const asset of Object.keys(thresholds)) {
  const since = new Date(today.getTime() - 10 * 86_400_000).toISOString().slice(0, 10);
  const [marketResponse, forecastResponse] = await Promise.all([
    fetch(`${baseUrl}/api/market-data?asset=${asset}&since=${since}`),
    fetch(`${baseUrl}/api/forecast?asset=${asset}&horizon=180&confidence=0.95`),
  ]);
  if (!marketResponse.ok || !forecastResponse.ok) {
    console.error(`${asset}: endpoint failure market=${marketResponse.status} forecast=${forecastResponse.status}`);
    failed = true;
    continue;
  }
  const market = await marketResponse.json();
  const forecast = await forecastResponse.json();
  const age = asset === 'btc'
    ? Math.floor((today.getTime() - Date.parse(`${market.latestDate}T00:00:00Z`)) / 86_400_000)
    : countUsMarketSessionsAfter(market.latestDate, today);
  const agrees = market.latestDate === forecast.latest.date;
  console.log(`${asset}: latest=${market.latestDate} status=${market.status} age=${age}d forecastAgreement=${agrees}`);
  if (market.status === 'unavailable' || age > thresholds[asset] || !agrees) failed = true;
}

if (failed) process.exitCode = 1;
