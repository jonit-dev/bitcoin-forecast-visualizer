#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/etf-flow-history.json');
const URL = 'https://farside.co.uk/bitcoin-etf-flow-all-data/';
const MS_PER_DAY = 86400000;
const FLOW_COLUMNS = ['IBIT', 'FBTC', 'BITB', 'ARKB', 'BTCO', 'EZBC', 'BRRR', 'HODL', 'BTCW', 'MSBT', 'GBTC', 'BTC'];

function startOfUtcDay(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addUtcDays(date, days) {
  return new Date(startOfUtcDay(date) + days * MS_PER_DAY).toISOString().split('T')[0];
}

function isoAtStartOfNextUtcDay(date) {
  return new Date(startOfUtcDay(addUtcDays(date, 1))).toISOString();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8211;|&ndash;|&mdash;/gi, '-')
    .replace(/&minus;/gi, '-')
    .replace(/&copy;/gi, '(c)')
    .replace(/\s+/g, ' ')
    .trim();
}

function textFromCell(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, ' '));
}

function parseFlowMillions(value) {
  const clean = decodeHtml(value).replace(/,/g, '').trim();
  if (!clean || clean === '-' || clean.toLowerCase() === 'n/a') return 0;
  const paren = /^\((.+)\)$/.exec(clean);
  const numeric = Number((paren ? paren[1] : clean).replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return paren ? -numeric : numeric;
}

function parseSourceDate(value) {
  const parsed = Date.parse(`${value} UTC`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().split('T')[0];
}

function extractFlowTable(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(match => match[0]);
  const table = tables.find(item => item.includes('IBIT') && item.includes('GBTC') && item.includes('Total'));
  if (!table) throw new Error('Could not find ETF flow table in Farside HTML');
  return table;
}

function parseRows(tableHtml) {
  const trMatches = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(match => match[0]);
  if (trMatches.length < 2) throw new Error('ETF flow table has too few rows');

  const header = [...trMatches[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => textFromCell(match[1]));
  const totalIndex = header.indexOf('Total');
  if (header[0] !== 'Date' || totalIndex < 0) throw new Error(`Unexpected ETF flow header: ${header.join(', ')}`);
  for (const column of FLOW_COLUMNS) {
    if (!header.includes(column)) throw new Error(`ETF flow table missing ${column} column`);
  }

  let cumulativeFlowUSDm = 0;
  return trMatches
    .slice(1)
    .map(rowHtml => {
      const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => textFromCell(match[1]));
      if (cells.length !== header.length) return null;
      const date = parseSourceDate(cells[0]);
      if (!date) return null;
      const funds = {};
      for (const column of FLOW_COLUMNS) {
        const value = parseFlowMillions(cells[header.indexOf(column)]);
        if (value === null) throw new Error(`Bad ${column} flow on ${cells[0]}: ${cells[header.indexOf(column)]}`);
        funds[column] = value;
      }
      const totalFlowUSDm = parseFlowMillions(cells[totalIndex]);
      if (totalFlowUSDm === null) throw new Error(`Bad total flow on ${cells[0]}: ${cells[totalIndex]}`);
      const fundSumUSDm = Object.values(funds).reduce((sum, value) => sum + value, 0);
      cumulativeFlowUSDm += totalFlowUSDm;
      return {
        date,
        source: 'Farside Investors Bitcoin ETF Flow - All Data',
        latestSourceDate: date,
        availableAfter: isoAtStartOfNextUtcDay(date),
        metrics: {
          totalFlowUSDm,
          totalFlowUSD: totalFlowUSDm * 1_000_000,
          cumulativeFlowUSDm,
          cumulativeFlowUSD: cumulativeFlowUSDm * 1_000_000,
          fundSumUSDm,
          fundFlowsUSDm: funds,
        },
        timing: {
          sourceDate: date,
          conservativeAvailableAfter: isoAtStartOfNextUtcDay(date),
        },
        missingMetrics: [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function writeUnavailable(fetchedAt, note) {
  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'Farside Investors Bitcoin ETF Flow - All Data',
      status: 'unavailable',
      fetchedAt,
      url: URL,
      fields: ['totalFlowUSDm', 'cumulativeFlowUSDm', 'fundFlowsUSDm'],
      cadence: 'daily business days',
      credentialRequired: false,
      note,
    },
    rows: [],
  }, null, 2)}\n`);
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const res = await fetch(URL, { headers: { 'User-Agent': 'bitcoin-forecast-visualizer' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${URL}`);
  const html = await res.text();
  const rows = parseRows(extractFlowTable(html));
  if (rows.length < 100) throw new Error(`ETF flow parse produced too few rows: ${rows.length}`);

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'Farside Investors Bitcoin ETF Flow - All Data',
      status: 'available',
      fetchedAt,
      url: URL,
      fields: ['totalFlowUSDm', 'totalFlowUSD', 'cumulativeFlowUSDm', 'cumulativeFlowUSD', 'fundFlowsUSDm'],
      cadence: 'daily business days',
      credentialRequired: false,
      limitations: [
        'Farside publishes a public HTML table, not a versioned API; parser failures should leave ETF features unavailable rather than silently changing methodology.',
        'Flows are reported in US$m by source methodology and are joined into features only after the next UTC day.',
        'ETF features remain context-only unless the dedicated ETF demand experiment passes the out-of-sample promotion gate.',
      ],
      docs: {
        source: URL,
      },
    },
    rows,
  }, null, 2)}\n`);

  console.log([
    '[ETF flow data] updated',
    `rows=${rows.length}`,
    `first=${rows[0]?.date ?? 'n/a'}`,
    `last=${rows.at(-1)?.date ?? 'n/a'}`,
    `latestFlowUSDm=${rows.at(-1)?.metrics.totalFlowUSDm ?? 'n/a'}`,
    `path=${OUT_PATH}`,
  ].join('  '));
}

main().catch(err => {
  const fetchedAt = new Date().toISOString();
  writeUnavailable(fetchedAt, `Fetch or parse failed: ${err.message}`);
  console.error(`[ETF flow data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
