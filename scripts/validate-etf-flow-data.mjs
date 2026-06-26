#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = join(__dirname, '../src/data/etf-flow-history.json');

function main() {
  const cache = JSON.parse(readFileSync(PATH, 'utf8'));
  const rows = cache.rows;
  if (!Array.isArray(rows)) throw new Error('ETF flow rows must be an array');
  if (cache.metadata?.status === 'available' && rows.length < 100) throw new Error(`too few available ETF flow rows: ${rows.length}`);

  const seen = new Set();
  let previous = null;
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`bad date: ${row.date}`);
    if (seen.has(row.date)) throw new Error(`duplicate date: ${row.date}`);
    seen.add(row.date);
    if (previous && row.date <= previous) throw new Error(`rows not strictly ascending at ${row.date}`);
    previous = row.date;
    if (!row.metrics || typeof row.metrics !== 'object') throw new Error(`missing metrics on ${row.date}`);
    for (const key of ['totalFlowUSDm', 'totalFlowUSD', 'cumulativeFlowUSDm', 'cumulativeFlowUSD', 'fundSumUSDm']) {
      if (!Number.isFinite(row.metrics[key])) throw new Error(`bad ${key} on ${row.date}`);
    }
    if (!row.metrics.fundFlowsUSDm || typeof row.metrics.fundFlowsUSDm !== 'object') {
      throw new Error(`missing fundFlowsUSDm on ${row.date}`);
    }
    for (const [fund, value] of Object.entries(row.metrics.fundFlowsUSDm)) {
      if (!Number.isFinite(value)) throw new Error(`bad ${fund} flow on ${row.date}`);
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
    '[ETF flow validation] OK',
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
  console.error(`[ETF flow validation] FAILED: ${err.message}`);
  process.exitCode = 1;
}
