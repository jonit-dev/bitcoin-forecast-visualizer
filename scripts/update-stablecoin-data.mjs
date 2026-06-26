#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/stablecoin-history.json');
const URL = 'https://stablecoins.llama.fi/stablecoincharts/all';
const MS_PER_DAY = 86400000;

function dateKey(epochSeconds) {
  return new Date(Number(epochSeconds) * 1000).toISOString().split('T')[0];
}

function startOfUtcDay(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addUtcDays(date, days) {
  return new Date(startOfUtcDay(date) + days * MS_PER_DAY).toISOString().split('T')[0];
}

function isoAtStartOfNextUtcDay(date) {
  return new Date(startOfUtcDay(addUtcDays(date, 1))).toISOString();
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function trailingChange(rows, index, lookback, field) {
  if (index < lookback) return null;
  const current = rows[index].raw[field];
  const prior = rows[index - lookback].raw[field];
  return current > 0 && prior > 0 ? current / prior - 1 : null;
}

function trailingZScore(rows, index, lookback, field) {
  if (index < lookback) return null;
  const current = rows[index].raw[field];
  const prior = rows.slice(index - lookback, index).map(row => row.raw[field]).filter(Number.isFinite);
  if (prior.length < lookback * 0.8 || !Number.isFinite(current)) return null;
  const mean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  const variance = prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / prior.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (current - mean) / sd : null;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const res = await fetch(URL, { headers: { 'User-Agent': 'bitcoin-forecast-visualizer' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
  const payload = await res.json();
  if (!Array.isArray(payload)) throw new Error('Unexpected DeFiLlama stablecoin chart payload');

  const parsed = payload
    .map(row => {
      const date = dateKey(row.date);
      const totalSupplyUSD = finiteNumber(row.totalCirculatingUSD?.peggedUSD);
      return {
        date,
        sourceTimestamp: Number(row.date) * 1000,
        raw: { totalSupplyUSD },
      };
    })
    .filter(row => row.date && Number.isFinite(row.raw.totalSupplyUSD) && row.raw.totalSupplyUSD > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const rows = parsed.map((row, index) => {
    const metrics = {
      totalSupplyUSD: row.raw.totalSupplyUSD,
    };
    for (const lookback of [7, 30, 90, 365]) {
      const change = trailingChange(parsed, index, lookback, 'totalSupplyUSD');
      if (change !== null) metrics[`totalSupplyChange${lookback}d`] = change;
    }
    const z365 = trailingZScore(parsed, index, 365, 'totalSupplyUSD');
    if (z365 !== null) metrics.totalSupplyZ365d = z365;
    const impulse = metrics.totalSupplyChange30d !== undefined && metrics.totalSupplyChange365d !== undefined
      ? metrics.totalSupplyChange30d - metrics.totalSupplyChange365d / 12
      : null;
    if (impulse !== null && Number.isFinite(impulse)) metrics.liquidityImpulse30dVsAnnual = impulse;

    return {
      date: row.date,
      source: 'DeFiLlama Stablecoins API',
      fetchedAt,
      latestSourceDate: row.date,
      availableAfter: isoAtStartOfNextUtcDay(row.date),
      metrics,
      timing: {
        sourceTimestamp: new Date(row.sourceTimestamp).toISOString(),
        conservativeAvailableAfter: isoAtStartOfNextUtcDay(row.date),
      },
      missingMetrics: [],
    };
  });

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'DeFiLlama Stablecoins API',
      status: rows.length > 0 ? 'available' : 'unavailable',
      fetchedAt,
      url: URL,
      fields: [
        'totalSupplyUSD',
        'totalSupplyChange7d',
        'totalSupplyChange30d',
        'totalSupplyChange90d',
        'totalSupplyChange365d',
        'totalSupplyZ365d',
        'liquidityImpulse30dVsAnnual',
      ],
      cadence: 'daily',
      credentialRequired: false,
      limitations: [
        'DeFiLlama historical stablecoin data can be revised/backfilled; use conservative one-day lag for point-in-time research.',
        'This cache uses aggregate stablecoin circulating supply in USD across all supported stablecoins.',
        'Features are context/research-only until walk-forward ablations prove forecast value.',
      ],
      docs: {
        stablecoinsApi: 'https://stablecoins.llama.fi/stablecoincharts/all',
      },
    },
    rows,
  }, null, 2)}\n`);

  console.log([
    '[Stablecoin data] updated',
    `rows=${rows.length}`,
    `first=${rows[0]?.date ?? 'n/a'}`,
    `last=${rows.at(-1)?.date ?? 'n/a'}`,
    `latestSupplyUSD=${rows.at(-1)?.metrics.totalSupplyUSD ?? 'n/a'}`,
    `path=${OUT_PATH}`,
  ].join('  '));
}

main().catch(err => {
  const fetchedAt = new Date().toISOString();
  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'DeFiLlama Stablecoins API',
      status: 'unavailable',
      fetchedAt,
      url: URL,
      fields: ['totalSupplyUSD'],
      cadence: 'daily',
      credentialRequired: false,
      note: `Fetch failed: ${err.message}`,
    },
    rows: [],
  }, null, 2)}\n`);
  console.error(`[Stablecoin data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
