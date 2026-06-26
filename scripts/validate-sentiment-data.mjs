#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = join(__dirname, '../src/data/sentiment-history.json');

function main() {
  const cache = JSON.parse(readFileSync(PATH, 'utf8'));
  const rows = cache.rows;
  if (!Array.isArray(rows)) throw new Error('sentiment rows must be an array');
  const seen = new Set();
  let previous = null;
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`bad date: ${row.date}`);
    if (seen.has(row.date)) throw new Error(`duplicate date: ${row.date}`);
    seen.add(row.date);
    if (previous && row.date <= previous) throw new Error(`rows not strictly ascending at ${row.date}`);
    previous = row.date;
    if (!row.metrics || typeof row.metrics !== 'object') throw new Error(`missing metrics on ${row.date}`);
    const value = row.metrics.fearGreedIndex;
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`bad fearGreedIndex on ${row.date}: ${value}`);
    for (const key of ['fearGreedChange7d', 'fearGreedChange30d', 'extremeFear', 'extremeGreed']) {
      if (row.metrics[key] !== undefined && !Number.isFinite(row.metrics[key])) throw new Error(`bad ${key} on ${row.date}`);
    }
    if (!row.availableAfter || Number.isNaN(Date.parse(row.availableAfter))) throw new Error(`bad availableAfter on ${row.date}`);
    if (Date.parse(row.availableAfter) <= Date.parse(`${row.date}T00:00:00Z`)) {
      throw new Error(`availableAfter must be after source date on ${row.date}`);
    }
    if (row.timing?.conservativeAvailableAfter && row.timing.conservativeAvailableAfter !== row.availableAfter) {
      throw new Error(`timing availableAfter mismatch on ${row.date}`);
    }
  }
  console.log([
    '[Sentiment validation] OK',
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
  console.error(`[Sentiment validation] FAILED: ${err.message}`);
  process.exitCode = 1;
}
