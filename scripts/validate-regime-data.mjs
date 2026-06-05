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

try {
  for (const [name, path, optional] of FILES) validateCache(name, path, optional);
} catch (err) {
  console.error(`[Regime validation] FAILED: ${err.message}`);
  process.exitCode = 1;
}
