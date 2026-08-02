import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VINTAGE_DIR } from './lib/vintageStore.mjs';

function assertSeries(series) {
  if (typeof series !== 'string' || !/^[A-Za-z0-9._-]+$/.test(series)) {
    throw new Error(`Invalid vintage series name: ${series}`);
  }
}

function candidateSeriesNames(series) {
  return series.startsWith('macro-') ? [series] : [series, `macro-${series}`];
}

function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD)`);
  }
  return value;
}

function observedAtTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`Invalid vintage observedAt: ${value}`);
  return time;
}

export function readVintageRecords(series, directory = VINTAGE_DIR) {
  assertSeries(series);
  const archiveSeries = candidateSeriesNames(series).find(candidate => existsSync(join(directory, `${candidate}.ndjson`)));
  const path = archiveSeries ? join(directory, `${archiveSeries}.ndjson`) : join(directory, `${series}.ndjson`);
  if (!archiveSeries) throw new Error(`No vintage archive found for series ${series}: ${path}`);
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid vintage archive line ${index + 1} for ${series}: ${error.message}`);
      }
    });
}

/**
 * Reconstruct the latest observation per asOfDate that was known by cutoff.
 * Future as-of dates are excluded because they were not part of that vintage.
 */
export function reconstructVintage(series, cutoff, directory = VINTAGE_DIR) {
  assertSeries(series);
  const asOfCutoff = parseDate(cutoff, 'cutoff');
  const cutoffTime = Date.parse(`${asOfCutoff}T23:59:59.999Z`);
  const selected = new Map();

  for (const record of readVintageRecords(series, directory)) {
    if (!candidateSeriesNames(series).includes(record.series)) {
      throw new Error(`Vintage archive ${series} contains a mismatched series record`);
    }
    if (typeof record.asOfDate !== 'string' || record.asOfDate > asOfCutoff) continue;
    const observedTime = observedAtTime(record.observedAt);
    if (observedTime > cutoffTime) continue;
    const previous = selected.get(record.asOfDate);
    if (!previous || observedTime >= observedAtTime(previous.observedAt)) selected.set(record.asOfDate, record);
  }

  return [...selected.values()].sort((left, right) => left.asOfDate < right.asOfDate ? -1 : left.asOfDate > right.asOfDate ? 1 : 0);
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function main(args = process.argv.slice(2)) {
  const series = argumentValue(args, '--series');
  const cutoff = argumentValue(args, '--as-of') ?? argumentValue(args, '--cutoff');
  if (!series) throw new Error('Usage: reconstruct:vintage --series SERIES --as-of YYYY-MM-DD');
  if (!cutoff) throw new Error('Usage: reconstruct:vintage --series SERIES --as-of YYYY-MM-DD');
  process.stdout.write(`${JSON.stringify(reconstructVintage(series, cutoff), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`[Vintage reconstruction] FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
