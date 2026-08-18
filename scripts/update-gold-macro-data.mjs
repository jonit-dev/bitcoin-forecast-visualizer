#!/usr/bin/env node
/**
 * Macro inputs for the GLD 365-day session-residual challenger.
 *
 * The frozen Ridge model reads a broad-dollar level, a 10-year real-yield proxy
 * (DGS10 - T10YIE) and gold-ETF implied volatility. Each series is carried
 * forward onto GLD sessions here; the one-session lag that keeps the current
 * GLD close from seeing a same-session macro close is applied at inference time
 * so this cache stays a faithful record of what FRED published per session.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

import { fetchFredObservations, requireFredApiKey } from './lib/fredApi.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(ROOT, '.env'), quiet: true });

const GLD_PATH = path.join(ROOT, 'src/data/gld-history.json');
const OUT_PATH = path.join(ROOT, 'src/data/gold-macro-history.json');

const SERIES = [
  ['DTWEXBGS', 'usdBroad', 'Nominal broad US dollar index'],
  ['DGS10', 'nominal10y', '10-year Treasury constant maturity rate'],
  ['T10YIE', 'breakeven10y', '10-year breakeven inflation rate'],
  ['GVZCLS', 'gvz', 'Cboe gold ETF volatility index'],
];

/** Last observation on or before `date`, walking a sorted observation array. */
function carryForward(observations, cursor, date) {
  let index = cursor;
  while (index + 1 < observations.length && observations[index + 1].date <= date) index += 1;
  if (observations[index] === undefined || observations[index].date > date) return { index, value: null };
  return { index, value: observations[index].value };
}

async function main() {
  const apiKey = requireFredApiKey();
  const sessions = JSON.parse(readFileSync(GLD_PATH, 'utf8')).map(row => row.date);
  if (sessions.length === 0) throw new Error('gld-history.json is empty; macro alignment needs GLD sessions.');

  const fetched = new Map();
  for (const [seriesId, field] of SERIES) {
    fetched.set(field, await fetchFredObservations(seriesId, apiKey));
  }

  const cursors = new Map([...fetched.keys()].map(field => [field, 0]));
  const rows = [];
  for (const date of sessions) {
    const values = {};
    let complete = true;
    for (const [field, observations] of fetched) {
      const { index, value } = carryForward(observations, cursors.get(field), date);
      cursors.set(field, index);
      if (value === null) complete = false;
      values[field] = value;
    }
    // Rows before every series has started would train nothing and cannot serve
    // inference; dropping them keeps the lag arithmetic in TS index-aligned.
    if (!complete) continue;
    rows.push({
      date,
      usdBroad: values.usdBroad,
      real10: Number((values.nominal10y - values.breakeven10y).toFixed(6)),
      gvz: values.gvz,
    });
  }

  if (rows.length < 1000) {
    throw new Error(`Only ${rows.length} aligned GLD macro sessions; existing cache preserved.`);
  }

  const metadata = {
    source: 'FRED observations API',
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    series: SERIES.map(([seriesId, field, label]) => ({ seriesId, field, label })),
    alignment: 'last FRED observation on or before each GLD session close',
    realYieldProxy: 'real10 = DGS10 - T10YIE',
    consumerLag: 'consumers must shift one GLD session before feature construction',
    limitations: [
      'FRED observations are latest revisions rather than point-in-time ALFRED vintages.',
      'The one-session lag prevents same-close look-ahead; it does not reconstruct vendor timestamps.',
    ],
  };

  writeFileSync(OUT_PATH, `${JSON.stringify({ metadata, rows }, null, 2)}\n`);
  console.log([
    '[Gold macro] updated',
    `rows=${rows.length}`,
    `first=${rows[0].date}`,
    `last=${rows.at(-1).date}`,
    `path=${OUT_PATH}`,
  ].join('  '));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Gold macro] FAILED: ${message.replace(/api_key=[^&\s]+/gi, 'api_key=[redacted]')}`);
  process.exitCode = 1;
});
