#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/sentiment-history.json');
const URL = 'https://api.alternative.me/fng/?limit=0&format=json';
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

async function main() {
  const fetchedAt = new Date().toISOString();
  const res = await fetch(URL, { headers: { 'User-Agent': 'bitcoin-forecast-visualizer' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
  const payload = await res.json();
  if (!Array.isArray(payload.data)) throw new Error('Unexpected Alternative.me Fear & Greed payload');

  const parsed = payload.data
    .map(row => {
      const date = dateKey(row.timestamp);
      const value = finiteNumber(row.value);
      return {
        date,
        sourceTimestamp: Number(row.timestamp) * 1000,
        raw: {
          fearGreedIndex: value,
          classification: String(row.value_classification || 'Unknown'),
        },
      };
    })
    .filter(row => row.date && row.raw.fearGreedIndex !== null && row.raw.fearGreedIndex >= 0 && row.raw.fearGreedIndex <= 100)
    .sort((a, b) => a.date.localeCompare(b.date));

  const rows = parsed.map((row, index) => {
    const metrics = {
      fearGreedIndex: row.raw.fearGreedIndex,
      extremeFear: row.raw.fearGreedIndex <= 25 ? 1 : 0,
      extremeGreed: row.raw.fearGreedIndex >= 75 ? 1 : 0,
    };
    for (const lookback of [7, 30]) {
      const prior = parsed[index - lookback]?.raw.fearGreedIndex;
      if (Number.isFinite(prior)) metrics[`fearGreedChange${lookback}d`] = row.raw.fearGreedIndex - prior;
    }
    return {
      date: row.date,
      source: 'Alternative.me Fear & Greed Index API',
      fetchedAt,
      latestSourceDate: row.date,
      availableAfter: isoAtStartOfNextUtcDay(row.date),
      metrics,
      classification: row.raw.classification,
      timing: {
        sourceTimestamp: new Date(row.sourceTimestamp).toISOString(),
        conservativeAvailableAfter: isoAtStartOfNextUtcDay(row.date),
      },
      missingMetrics: [],
    };
  });

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'Alternative.me Fear & Greed Index API',
      status: rows.length > 0 ? 'available' : 'unavailable',
      fetchedAt,
      url: URL,
      fields: [
        'fearGreedIndex',
        'fearGreedChange7d',
        'fearGreedChange30d',
        'extremeFear',
        'extremeGreed',
      ],
      cadence: 'daily',
      credentialRequired: false,
      limitations: [
        'Alternative.me methodology is external and may change; use as optional context unless out-of-sample experiments prove forecast value.',
        'Rows are conservatively treated as available after the next UTC day for feature-table joins.',
      ],
      docs: {
        api: 'https://alternative.me/crypto/fear-and-greed-index/',
      },
    },
    rows,
  }, null, 2)}\n`);

  console.log([
    '[Sentiment data] updated',
    `rows=${rows.length}`,
    `first=${rows[0]?.date ?? 'n/a'}`,
    `last=${rows.at(-1)?.date ?? 'n/a'}`,
    `latestIndex=${rows.at(-1)?.metrics.fearGreedIndex ?? 'n/a'}`,
    `path=${OUT_PATH}`,
  ].join('  '));
}

main().catch(err => {
  const fetchedAt = new Date().toISOString();
  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'Alternative.me Fear & Greed Index API',
      status: 'unavailable',
      fetchedAt,
      url: URL,
      fields: ['fearGreedIndex'],
      cadence: 'daily',
      credentialRequired: false,
      note: `Fetch failed: ${err.message}`,
    },
    rows: [],
  }, null, 2)}\n`);
  console.error(`[Sentiment data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
