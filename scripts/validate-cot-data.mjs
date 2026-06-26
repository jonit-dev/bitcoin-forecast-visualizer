#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = join(__dirname, '../src/data/cot-history.json');

function main() {
  const cache = JSON.parse(readFileSync(PATH, 'utf8'));
  const rows = cache.rows;
  if (!Array.isArray(rows)) throw new Error('COT rows must be an array');
  const seen = new Set();
  let previous = null;
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`bad date: ${row.date}`);
    if (seen.has(row.date)) throw new Error(`duplicate date: ${row.date}`);
    seen.add(row.date);
    if (previous && row.date <= previous) throw new Error(`rows not ascending at ${row.date}`);
    previous = row.date;
    if (!row.availableAfter || Number.isNaN(Date.parse(row.availableAfter))) throw new Error(`bad availableAfter on ${row.date}`);
    if (Date.parse(row.availableAfter) <= Date.parse(`${row.date}T00:00:00Z`)) {
      throw new Error(`availableAfter must be after report date on ${row.date}`);
    }
    if (!row.metrics || typeof row.metrics !== 'object') throw new Error(`missing metrics on ${row.date}`);
    if (!Number.isFinite(row.metrics.openInterestBtc) || row.metrics.openInterestBtc <= 0) {
      throw new Error(`bad openInterestBtc on ${row.date}`);
    }
    for (const key of Object.keys(row.metrics)) {
      if (!Number.isFinite(row.metrics[key])) throw new Error(`non-finite ${key} on ${row.date}`);
    }
    if (!Array.isArray(row.contracts) || row.contracts.length < 1) throw new Error(`missing contracts on ${row.date}`);
  }
  console.log([
    '[COT validation] OK',
    `status=${cache.metadata?.status ?? 'available'}`,
    `rows=${rows.length}`,
    `first=${rows[0]?.date ?? 'n/a'}`,
    `latest=${rows.at(-1)?.date ?? 'n/a'}`,
    `source=${cache.metadata?.source ?? 'n/a'}`,
  ].join('  '));
}

try {
  main();
} catch (err) {
  console.error(`[COT validation] FAILED: ${err.message}`);
  process.exitCode = 1;
}
