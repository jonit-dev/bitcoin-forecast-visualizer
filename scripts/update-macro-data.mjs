#!/usr/bin/env node
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/macro-history.json');
const SERIES = ['WALCL', 'FEDFUNDS', 'DGS10', 'BAMLH0A0HYM2', 'M2SL'];

if (!process.env.FRED_API_KEY) {
  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'FRED',
      status: 'missing-credential',
      fetchedAt: new Date().toISOString(),
      series: SERIES,
      cadence: 'mixed daily/weekly/monthly',
      credentialRequired: true,
      note: 'FRED_API_KEY is required to populate macro rows. This unavailable cache is optional and should not block required BTC/MVRV/on-chain validation.',
    },
    rows: [],
  }, null, 2)}\n`);
  console.error('[Macro data] FAILED: FRED_API_KEY is required to update macro-history.json. Add it to .env; never commit the secret value.');
  process.exit(1);
}

async function fetchSeries(seriesId) {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', process.env.FRED_API_KEY);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('observation_start', '2010-07-17');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId} failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return (json.observations || [])
    .filter(row => row.value !== '.')
    .map(row => ({ observedDate: row.date, value: Number(row.value) }))
    .filter(row => Number.isFinite(row.value));
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const bySeries = {};
  for (const series of SERIES) bySeries[series] = await fetchSeries(series);

  const allDates = [...new Set(Object.values(bySeries).flat().map(row => row.observedDate))].sort();
  const rows = allDates.map(date => {
    const metrics = {};
    const observedDates = {};
    for (const series of SERIES) {
      const latest = bySeries[series].filter(row => row.observedDate <= date).at(-1);
      if (latest) {
        metrics[series] = latest.value;
        observedDates[series] = latest.observedDate;
      }
    }
    return { date, source: 'FRED', fetchedAt, metrics, observedDates };
  });

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'FRED',
      status: 'available',
      fetchedAt,
      series: SERIES,
      cadence: 'mixed daily/weekly/monthly',
      credentialRequired: true,
    },
    rows,
  }, null, 2)}\n`);
  console.log(`[Macro data] updated rows=${rows.length} latest=${rows.at(-1)?.date} source=FRED path=${OUT_PATH}`);
}

main().catch(err => {
  console.error(`[Macro data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
