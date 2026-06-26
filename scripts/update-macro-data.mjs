#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/macro-history.json');
const SERIES = [
  ['WALCL', 'Fed balance sheet assets'],
  ['FEDFUNDS', 'Effective federal funds rate'],
  ['DGS10', '10-year Treasury yield'],
  ['BAMLH0A0HYM2', 'US high-yield option-adjusted spread'],
  ['M2SL', 'M2 money stock'],
];
const START_DATE = '2010-07-17';
const MS_PER_DAY = 86400000;
const CONSERVATIVE_LAG_DAYS = 30;

function startOfUtcDay(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addUtcDays(date, days) {
  return new Date(startOfUtcDay(date) + days * MS_PER_DAY).toISOString().split('T')[0];
}

function isoAfterLag(date) {
  return new Date(startOfUtcDay(addUtcDays(date, CONSERVATIVE_LAG_DAYS))).toISOString();
}

function parseCsv(text, seriesId) {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map(line => {
      const [date, raw] = line.split(',');
      const value = Number(raw);
      return { date, value };
    })
    .filter(row => row.date >= START_DATE && Number.isFinite(row.value));
}

async function fetchSeries(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'bitcoin-forecast-visualizer' } });
  if (!res.ok) throw new Error(`FRED ${seriesId} failed: ${res.status} ${res.statusText}`);
  return parseCsv(await res.text(), seriesId);
}

function valueOnOrBefore(rows, date) {
  let latest = null;
  for (const row of rows) {
    if (row.date > date) break;
    latest = row;
  }
  return latest;
}

function change(bySeries, seriesId, date, lookbackDays) {
  const current = valueOnOrBefore(bySeries[seriesId], date);
  const prior = valueOnOrBefore(bySeries[seriesId], addUtcDays(date, -lookbackDays));
  if (!current || !prior || prior.value === 0) return null;
  return current.value / prior.value - 1;
}

function diff(bySeries, seriesId, date, lookbackDays) {
  const current = valueOnOrBefore(bySeries[seriesId], date);
  const prior = valueOnOrBefore(bySeries[seriesId], addUtcDays(date, -lookbackDays));
  if (!current || !prior) return null;
  return current.value - prior.value;
}

function zScore(prior, value) {
  const finite = prior.filter(Number.isFinite);
  if (finite.length < 120 || !Number.isFinite(value)) return null;
  const mean = finite.reduce((sum, item) => sum + item, 0) / finite.length;
  const variance = finite.reduce((sum, item) => sum + (item - mean) ** 2, 0) / finite.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (value - mean) / sd : null;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const entries = await Promise.all(SERIES.map(async ([seriesId]) => [seriesId, await fetchSeries(seriesId)]));
  const bySeries = Object.fromEntries(entries);
  const allDates = [...new Set(Object.values(bySeries).flat().map(row => row.date))]
    .filter(date => date >= START_DATE)
    .sort();
  const start = allDates[0];
  const end = allDates.at(-1);
  const hyHistory = [];
  const dgs10History = [];
  const walclImpulseHistory = [];
  const rows = [];

  for (let date = start; date <= end; date = addUtcDays(date, 1)) {
    const latest = Object.fromEntries(Object.keys(bySeries).map(seriesId => [seriesId, valueOnOrBefore(bySeries[seriesId], date)]));
    if (!latest.WALCL || !latest.FEDFUNDS || !latest.DGS10 || !latest.BAMLH0A0HYM2 || !latest.M2SL) continue;
    const walclChange13w = change(bySeries, 'WALCL', date, 91);
    const walclChange26w = change(bySeries, 'WALCL', date, 182);
    const fedFundsChange13w = diff(bySeries, 'FEDFUNDS', date, 91);
    const dgs10Change30d = diff(bySeries, 'DGS10', date, 30);
    const dgs10Change90d = diff(bySeries, 'DGS10', date, 90);
    const m2Change26w = change(bySeries, 'M2SL', date, 182);
    const hySpread = latest.BAMLH0A0HYM2.value;
    const dgs10 = latest.DGS10.value;
    const hySpreadZ252d = zScore(hyHistory.slice(-252), hySpread);
    const dgs10Z252d = zScore(dgs10History.slice(-252), dgs10);
    const walclImpulseZ252d = zScore(walclImpulseHistory.slice(-252), walclChange13w);
    const macroRiskScore = [
      hySpreadZ252d,
      dgs10Z252d,
      Number.isFinite(walclImpulseZ252d) ? -walclImpulseZ252d : null,
      Number.isFinite(fedFundsChange13w) ? fedFundsChange13w : null,
    ].filter(Number.isFinite);
    const metrics = {
      fedBalanceSheetAssets: latest.WALCL.value,
      fedBalanceSheetChange13w: walclChange13w,
      fedBalanceSheetChange26w: walclChange26w,
      fedFundsRate: latest.FEDFUNDS.value,
      fedFundsChange13w,
      treasury10yYield: dgs10,
      treasury10yChange30d: dgs10Change30d,
      treasury10yChange90d: dgs10Change90d,
      highYieldSpread: hySpread,
      highYieldSpreadZ252d: hySpreadZ252d,
      m2MoneyStock: latest.M2SL.value,
      m2Change26w,
      liquidityImpulseZ252d: walclImpulseZ252d,
      macroRiskScore: macroRiskScore.length >= 2 ? macroRiskScore.reduce((sum, item) => sum + item, 0) / macroRiskScore.length : null,
    };
    rows.push({
      date,
      source: 'FRED CSV',
      fetchedAt,
      latestSourceDate: date,
      availableAfter: isoAfterLag(date),
      metrics: Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value))),
      observedDates: Object.fromEntries(Object.entries(latest).map(([seriesId, row]) => [seriesId, row.date])),
      timing: {
        conservativeAvailableAfter: isoAfterLag(date),
        conservativeLagDays: CONSERVATIVE_LAG_DAYS,
      },
      missingMetrics: Object.entries(metrics).filter(([, value]) => !Number.isFinite(value)).map(([key]) => key),
    });
    hyHistory.push(hySpread);
    dgs10History.push(dgs10);
    if (Number.isFinite(walclChange13w)) walclImpulseHistory.push(walclChange13w);
  }

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'FRED CSV',
      status: rows.length > 0 ? 'available' : 'unavailable',
      fetchedAt,
      series: Object.fromEntries(SERIES),
      cadence: 'mixed daily/weekly/monthly aligned to daily last-known values',
      credentialRequired: false,
      conservativeLagDays: CONSERVATIVE_LAG_DAYS,
      limitations: [
        'This uses latest FRED observations, not ALFRED vintages; revision-sensitive fields are context-only unless a future vintage-safe implementation validates them.',
        'All macro rows use a conservative 30-day availableAfter lag before feature-table use.',
      ],
      docs: {
        fredCsv: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES_ID',
      },
    },
    rows,
  }, null, 2)}\n`);

  console.log([
    '[Macro data] updated',
    `rows=${rows.length}`,
    `first=${rows[0]?.date ?? 'n/a'}`,
    `last=${rows.at(-1)?.date ?? 'n/a'}`,
    `source=FRED CSV`,
    `path=${OUT_PATH}`,
  ].join('  '));
}

main().catch(err => {
  const fetchedAt = new Date().toISOString();
  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'FRED CSV',
      status: 'unavailable',
      fetchedAt,
      series: Object.fromEntries(SERIES),
      cadence: 'mixed daily/weekly/monthly',
      credentialRequired: false,
      note: `Fetch failed: ${err.message}`,
    },
    rows: [],
  }, null, 2)}\n`);
  console.error(`[Macro data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
