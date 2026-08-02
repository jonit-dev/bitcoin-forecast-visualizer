import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VINTAGE_DIR = join(__dirname, '../../src/data/vintages');

function assertSeries(series) {
  if (typeof series !== 'string' || !/^[A-Za-z0-9._-]+$/.test(series)) {
    throw new Error(`Invalid vintage series name: ${series}`);
  }
}

function resolveDirectory(directoryOrOptions) {
  if (typeof directoryOrOptions === 'string') return directoryOrOptions;
  if (directoryOrOptions && typeof directoryOrOptions.directory === 'string') return directoryOrOptions.directory;
  return VINTAGE_DIR;
}

function normalizeRecord(series, record) {
  if (!record || typeof record !== 'object') throw new Error(`Vintage record for ${series} must be an object`);
  if (typeof record.asOfDate !== 'string' || record.asOfDate.length === 0) {
    throw new Error(`Vintage record for ${series} is missing asOfDate`);
  }
  if (typeof record.observedAt !== 'string' || record.observedAt.length === 0) {
    throw new Error(`Vintage record for ${series} is missing observedAt`);
  }
  if (!Object.hasOwn(record, 'value')) {
    throw new Error(`Vintage record for ${series} is missing value`);
  }
  return {
    series,
    asOfDate: record.asOfDate,
    observedAt: record.observedAt,
    value: record.value,
  };
}

/**
 * Append vintage records without reading or rewriting the previous archive.
 * The optional third argument is used by offline tests to point at a temp dir.
 */
export function appendVintageRecords(series, records, directoryOrOptions = VINTAGE_DIR) {
  assertSeries(series);
  if (!Array.isArray(records)) throw new TypeError('appendVintageRecords expects an array of records');
  if (records.length === 0) return { path: join(resolveDirectory(directoryOrOptions), `${series}.ndjson`), count: 0 };

  const directory = resolveDirectory(directoryOrOptions);
  const path = join(directory, `${series}.ndjson`);
  const lines = records.map(record => `${JSON.stringify(normalizeRecord(series, record))}\n`).join('');
  mkdirSync(directory, { recursive: true });
  appendFileSync(path, lines, 'utf8');
  return { path, count: records.length };
}
