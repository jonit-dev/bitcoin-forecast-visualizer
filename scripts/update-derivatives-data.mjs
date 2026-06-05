#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/derivatives-history.json');

const payload = {
  metadata: {
    source: 'not configured',
    status: 'unavailable',
    fetchedAt: new Date().toISOString(),
    fields: ['openInterestUSD', 'fundingRate'],
    cadence: 'daily',
    credentialRequired: false,
    note: 'No stable free historical derivatives source is enabled for baseline v2. This cache is optional and must stay context-only until a source is selected and validated.',
  },
  rows: [],
};

writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log('[Derivatives data] optional source unavailable; wrote explicit empty cache');
console.log(`path=${OUT_PATH}  status=${payload.metadata.status}  source=${payload.metadata.source}`);
