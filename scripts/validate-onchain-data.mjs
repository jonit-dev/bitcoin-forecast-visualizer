#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/onchain-history.json');
const MS_PER_DAY = 86400000;
const REQUIRED_CORE_FIELDS = ['mvrv', 'marketCapUSD', 'realizedCapUSD', 'realizedPriceUSD', 'activeAddresses', 'transactionCount', 'hashRate'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function daysBetween(fromDate, toDate) {
  return Math.round((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / MS_PER_DAY);
}

function main() {
  const rows = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  assert(Array.isArray(rows), 'onchain-history.json must be an array');
  assert(rows.length > 365, `on-chain row count too low: ${rows.length}`);

  const seen = new Set();
  let previousDate = null;
  let missingDateCount = 0;
  let latestSourceDate = null;
  let maxDaysLag = 0;

  for (const row of rows) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(row.date), `bad date: ${row.date}`);
    assert(!seen.has(row.date), `duplicate date: ${row.date}`);
    assert(row.source === 'CoinMetrics Community API', `unexpected source on ${row.date}: ${row.source}`);
    assert(typeof row.fetchedAt === 'string' && row.fetchedAt.includes('T'), `bad fetchedAt on ${row.date}`);
    assert(row.latestSourceDate && /^\d{4}-\d{2}-\d{2}$/.test(row.latestSourceDate), `bad latestSourceDate on ${row.date}`);

    if (previousDate) {
      const gap = daysBetween(previousDate, row.date);
      assert(gap > 0, `non-increasing date at ${row.date}`);
      if (gap !== 1) missingDateCount += gap - 1;
    }

    for (const field of REQUIRED_CORE_FIELDS) {
      assert(Number.isFinite(row.metrics?.[field]) && row.metrics[field] > 0, `missing or invalid core field ${field} on ${row.date}`);
    }
    for (const [field, value] of Object.entries(row.metrics || {})) {
      if (value === null) continue;
      assert(Number.isFinite(value), `non-finite metric ${field} on ${row.date}`);
      assert(value >= 0, `negative metric ${field} on ${row.date}`);
    }

    seen.add(row.date);
    previousDate = row.date;
    latestSourceDate = row.latestSourceDate;
    maxDaysLag = Math.max(maxDaysLag, row.daysLag ?? 0);
  }

  assert(missingDateCount <= 3, `excessive on-chain missing dates: ${missingDateCount}`);

  console.log('[On-chain validation] OK');
  console.log(
    [
      `rows=${rows.length}`,
      `first=${rows[0].date}`,
      `last=${rows.at(-1).date}`,
      `latestSourceDate=${latestSourceDate}`,
      `missingDateCount=${missingDateCount}`,
      `sourceLagDays=${rows.at(-1).daysLag}`,
      `maxDaysLag=${maxDaysLag}`,
      `source=CoinMetrics Community API`,
    ].join('  ')
  );
}

try {
  main();
} catch (err) {
  console.error(`[On-chain validation] FAILED: ${err.message}`);
  process.exitCode = 1;
}
