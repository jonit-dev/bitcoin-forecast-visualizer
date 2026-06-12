#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILES = [
  ['derivatives', '../src/data/derivatives-history.json', true],
  ['etf-flow', '../src/data/etf-flow-history.json', true],
  ['macro', '../src/data/macro-history.json', true],
];

function validateCache(name, relativePath, optional) {
  const path = join(__dirname, relativePath);
  if (!existsSync(path)) {
    if (optional) {
      console.log(`[Regime validation] ${name}: optional cache missing`);
      return;
    }
    throw new Error(`${name} cache missing`);
  }

  const cache = JSON.parse(readFileSync(path, 'utf8'));
  const rows = Array.isArray(cache) ? cache : cache.rows;
  const metadata = Array.isArray(cache) ? {} : cache.metadata || {};
  if (!Array.isArray(rows)) throw new Error(`${name} rows must be an array`);

  let duplicateCount = 0;
  const seen = new Set();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`${name} bad date: ${row.date}`);
    if (seen.has(row.date)) duplicateCount++;
    seen.add(row.date);
    if (name === 'derivatives') validateDerivativesRow(row);
  }
  if (duplicateCount > 0) throw new Error(`${name} duplicate dates: ${duplicateCount}`);

  console.log(
    [
      `[Regime validation] ${name}: OK`,
      `status=${metadata.status || 'available'}`,
      `rows=${rows.length}`,
      `latest=${rows.at(-1)?.date || 'n/a'}`,
      `source=${metadata.source || rows.at(-1)?.source || 'n/a'}`,
      `cadence=${metadata.cadence || 'daily'}`,
      `credentialRequired=${metadata.credentialRequired ?? false}`,
    ].join('  ')
  );
}

function validateDerivativesRow(row) {
  if (row.symbol !== 'BTCUSDT') throw new Error(`derivatives unsupported symbol on ${row.date}: ${row.symbol}`);
  if (!row.metrics || typeof row.metrics !== 'object') throw new Error(`derivatives missing metrics on ${row.date}`);
  if (!row.availableAfter || Number.isNaN(Date.parse(row.availableAfter))) {
    throw new Error(`derivatives missing availableAfter on ${row.date}`);
  }
  if (row.availableAfter < `${row.date}T00:00:00.000Z`) {
    throw new Error(`derivatives availableAfter precedes source date on ${row.date}`);
  }
  validateDerivativesTiming(row);
  const numericFields = [
    'fundingRateDailyAvg',
    'fundingRateDailySum',
    'fundingObservationCount',
    'openInterestBTC',
    'openInterestUSD',
  ];
  for (const field of numericFields) {
    if (row.metrics[field] === undefined) continue;
    if (!Number.isFinite(row.metrics[field])) throw new Error(`derivatives non-finite ${field} on ${row.date}`);
  }
  if (row.metrics.fundingObservationCount !== undefined && row.metrics.fundingObservationCount < 1) {
    throw new Error(`derivatives bad fundingObservationCount on ${row.date}`);
  }
}

function validateDerivativesTiming(row) {
  const timing = row.timing || {};
  if (timing.conservativeAvailableAfter && timing.conservativeAvailableAfter !== row.availableAfter) {
    throw new Error(`derivatives mismatched availableAfter on ${row.date}`);
  }
  if (Array.isArray(timing.fundingEventTimes)) {
    for (const timestamp of timing.fundingEventTimes) {
      if (Number.isNaN(Date.parse(timestamp))) throw new Error(`derivatives bad funding timestamp on ${row.date}`);
      if (!timestamp.startsWith(row.date)) throw new Error(`derivatives funding timestamp outside row date on ${row.date}`);
    }
  }
  if (timing.openInterestTimestamp !== null && timing.openInterestTimestamp !== undefined) {
    if (Number.isNaN(Date.parse(timing.openInterestTimestamp))) throw new Error(`derivatives bad OI timestamp on ${row.date}`);
    if (!timing.openInterestTimestamp.startsWith(row.date)) throw new Error(`derivatives OI timestamp outside row date on ${row.date}`);
  }
}

try {
  for (const [name, path, optional] of FILES) validateCache(name, path, optional);
} catch (err) {
  console.error(`[Regime validation] FAILED: ${err.message}`);
  process.exitCode = 1;
}
