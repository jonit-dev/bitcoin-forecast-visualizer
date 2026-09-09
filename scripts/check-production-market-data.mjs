#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyContinuityGuard, repairWindowStart } from '../shared/market-continuity.mjs';
import { evaluateMarketSnapshot } from '../shared/market-data-smoke.mjs';

const baseUrl = (process.env.MARKET_DATA_BASE_URL || process.argv[2] || '').replace(/\/$/, '');
if (!baseUrl) throw new Error('Set MARKET_DATA_BASE_URL or pass the deployment URL');

const REPAIR_LOOKBACK_DAYS = 7;
const ASSETS = {
  btc: { staleAfterDays: 2, history: 'btc-history.json' },
  sp500: { staleAfterDays: 3, history: 'voo-history.json' },
  gold: { staleAfterDays: 3, history: 'gld-history.json' },
};

const bundleFor = (file) => JSON.parse(readFileSync(fileURLToPath(new URL(`../src/data/${file}`, import.meta.url)), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let failed = false;

for (const [assetId, config] of Object.entries(ASSETS)) {
  const bundle = bundleFor(config.history);
  // Mirror the browser exactly: same window, same merge, same guard.
  const since = repairWindowStart(bundle.at(-1).date, REPAIR_LOOKBACK_DAYS);
  const [marketResponse, forecastResponse] = await Promise.all([
    fetch(`${baseUrl}/api/market-data?asset=${assetId}&since=${since}`),
    fetch(`${baseUrl}/api/forecast?asset=${assetId}&horizon=180&confidence=0.95`),
  ]);
  if (!marketResponse.ok || !forecastResponse.ok) {
    console.error(`${assetId}: endpoint failure market=${marketResponse.status} forecast=${forecastResponse.status}`);
    failed = true;
    continue;
  }
  const market = await marketResponse.json();
  const forecast = await forecastResponse.json();

  const merged = new Map(bundle.map((row) => [row.date, row]));
  for (const row of market.rows ?? []) merged.set(row.date, row);
  const mergedRows = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  const browser = applyContinuityGuard(assetId, mergedRows, since);

  const result = evaluateMarketSnapshot({
    assetId,
    since,
    today,
    staleAfterDays: config.staleAfterDays,
    // Unguarded rows, so the evaluator detects a hole rather than seeing the
    // already-truncated series the guard hands the model.
    market: { ...market, rows: mergedRows.filter((row) => row.date >= since) },
    forecast,
  });
  if (browser.rows.at(-1).date !== market.latestDate) {
    result.reasons.push(`browser anchor ${browser.rows.at(-1).date} disagrees with server latest ${market.latestDate}`);
    result.ok = false;
  }
  if (browser.continuity.complete !== (market.continuity?.complete ?? true)) {
    result.reasons.push(`browser continuity complete=${browser.continuity.complete} disagrees with server ${market.continuity?.complete}`);
    result.ok = false;
  }

  console.log(`${assetId}: latest=${market.latestDate} observed=${market.observedLatestDate ?? market.latestDate} status=${market.status} contiguous=${market.continuity?.complete ?? 'unreported'} ok=${result.ok}`);
  for (const reason of result.reasons) console.error(`  ${assetId}: ${reason}`);
  if (!result.ok) failed = true;
}

if (failed) process.exitCode = 1;
