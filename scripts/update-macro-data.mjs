#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireEnv } from './lib/env.mjs';
import { mergeByKey } from './lib/mergeRows.mjs';
import { SOURCE_FRESHNESS_CAP_DAYS } from './lib/sourceFreshness.mjs';
import { appendVintageRecords } from './lib/vintageStore.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/macro-history.json');
export const ALFRED_OBSERVATIONS_URL = 'https://api.stlouisfed.org/fred/series/observations';
export const ALFRED_VINTAGE_DATES_URL = 'https://api.stlouisfed.org/fred/series/vintagedates';
export const MACRO_SERIES = [
  ['WALCL', 'Fed balance sheet assets'],
  ['FEDFUNDS', 'Effective federal funds rate'],
  ['DGS10', '10-year Treasury yield'],
  ['BAMLH0A0HYM2', 'US high-yield option-adjusted spread'],
  ['M2SL', 'M2 money stock'],
];
export const START_DATE = '2010-07-17';
export const CONSERVATIVE_LAG_DAYS = 30;
export const MAX_VINTAGE_REQUESTS_PER_SERIES = 48;
const MS_PER_DAY = 86400000;

function startOfUtcDay(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function dateKey(value) {
  return new Date(value).toISOString().split('T')[0];
}

function addUtcDays(date, days) {
  return dateKey(startOfUtcDay(date) + days * MS_PER_DAY);
}

function isoAfterLag(date) {
  return new Date(startOfUtcDay(addUtcDays(date, CONSERVATIVE_LAG_DAYS))).toISOString();
}

export function buildObservationsUrl(
  seriesId,
  apiKey,
  realtimeStart = dateKey(Date.now()),
  realtimeEnd = realtimeStart
) {
  const url = new URL(ALFRED_OBSERVATIONS_URL);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('observation_start', START_DATE);
  url.searchParams.set('realtime_start', realtimeStart);
  url.searchParams.set('realtime_end', realtimeEnd);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('output_type', '1');
  url.searchParams.set('sort_order', 'asc');
  return url;
}

export function buildVintageDatesUrl(
  seriesId,
  apiKey,
  realtimeStart = START_DATE,
  realtimeEnd = dateKey(Date.now())
) {
  const url = new URL(ALFRED_VINTAGE_DATES_URL);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('realtime_start', realtimeStart);
  url.searchParams.set('realtime_end', realtimeEnd);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('limit', '10000');
  url.searchParams.set('sort_order', 'asc');
  return url;
}

export function parseObservations(payload, seriesId) {
  if (!payload || !Array.isArray(payload.observations)) {
    throw new Error(`ALFRED ${seriesId} response did not contain observations`);
  }
  const observations = payload.observations
    .map(observation => ({
      asOfDate: observation.date,
      observedAt: observation.realtime_start,
      value: Number(observation.value),
    }))
    .filter(row => row.asOfDate >= START_DATE && typeof row.observedAt === 'string' && Number.isFinite(row.value))
    .sort((left, right) => left.asOfDate.localeCompare(right.asOfDate));
  if (observations.length === 0) throw new Error(`ALFRED ${seriesId} returned no finite observations`);
  return observations;
}

export function parseVintageDates(payload, seriesId) {
  if (!payload || !Array.isArray(payload.vintage_dates)) {
    throw new Error(`ALFRED ${seriesId} vintage-date response did not contain vintage_dates`);
  }
  return [...new Set(payload.vintage_dates)]
    .filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
}

export function selectVintageDates(
  vintageDates,
  {
    startDate = START_DATE,
    endDate = dateKey(Date.now()),
    maxDates = MAX_VINTAGE_REQUESTS_PER_SERIES,
  } = {}
) {
  if (!Array.isArray(vintageDates)) throw new TypeError('selectVintageDates expects an array');
  if (!Number.isInteger(maxDates) || maxDates < 2) {
    throw new RangeError('selectVintageDates requires maxDates >= 2');
  }

  const candidates = [...new Set([startDate, ...vintageDates, endDate])]
    .filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .filter(date => date >= startDate && date <= endDate)
    .sort();
  if (candidates.length <= maxDates) return candidates;

  // Keep the first and latest available snapshots, then sample the discovered
  // dates at deterministic evenly spaced positions. This bounds a first run
  // while retaining historical values from across the requested period.
  const selected = new Set();
  for (let index = 0; index < maxDates; index += 1) {
    const position = Math.round((index * (candidates.length - 1)) / (maxDates - 1));
    selected.add(candidates[position]);
  }
  return [...selected].sort();
}

async function fetchJson(url, label) {
  const res = await fetch(url, { headers: { 'User-Agent': 'bitcoin-forecast-visualizer' } });
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchSeries(seriesId, apiKey, realtimeStart, realtimeEnd = realtimeStart) {
  const url = buildObservationsUrl(seriesId, apiKey, realtimeStart, realtimeEnd);
  return parseObservations(await fetchJson(url, `ALFRED ${seriesId} observations`), seriesId);
}

async function fetchVintageDates(seriesId, apiKey, asOfDate) {
  const url = buildVintageDatesUrl(seriesId, apiKey, START_DATE, asOfDate);
  return parseVintageDates(await fetchJson(url, `ALFRED ${seriesId} vintage-date discovery`), seriesId);
}

export async function fetchHistoricalSeries(seriesId, apiKey, asOfDate = dateKey(Date.now())) {
  const discoveredVintageDates = await fetchVintageDates(seriesId, apiKey, asOfDate);
  const vintageDates = selectVintageDates(discoveredVintageDates, { endDate: asOfDate });
  const snapshots = [];

  // Sequential requests keep the external request rate bounded and make the
  // archive's observedAt order deterministic across repeated runs.
  for (const vintageDate of vintageDates) {
    const observations = await fetchSeries(seriesId, apiKey, vintageDate, vintageDate);
    if (observations.length > 0) snapshots.push({ vintageDate, observations });
  }

  const latest = snapshots.at(-1)?.observations ?? [];
  if (latest.length === 0) throw new Error(`ALFRED ${seriesId} returned no observations through ${asOfDate}`);
  return {
    latest,
    observations: snapshots.flatMap(snapshot => snapshot.observations),
    discoveredVintageDates,
    requestedVintageDates: vintageDates,
    successfulVintageDates: snapshots.map(snapshot => snapshot.vintageDate),
  };
}

function valueOnOrBefore(rows, date) {
  let latest = null;
  for (const row of rows) {
    if (row.asOfDate > date) break;
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

function readExistingRows() {
  if (!existsSync(OUT_PATH)) return [];
  const cache = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  return Array.isArray(cache) ? cache : cache.rows ?? [];
}

export async function main() {
  const apiKey = requireEnv('FRED_API_KEY');
  const observedAt = dateKey(Date.now());
  const fetchedAt = new Date().toISOString();
  const histories = [];
  for (const [seriesId] of MACRO_SERIES) {
    histories.push({ seriesId, ...(await fetchHistoricalSeries(seriesId, apiKey, observedAt)) });
  }
  const entries = histories.map(history => [history.seriesId, history.latest]);
  const bySeries = Object.fromEntries(entries);
  const allDates = [...new Set(Object.values(bySeries).flat().map(row => row.asOfDate))]
    .filter(date => date >= START_DATE)
    .sort();
  if (allDates.length === 0) throw new Error('ALFRED returned no dates across the requested macro series');

  const start = allDates[0];
  const end = allDates.at(-1);
  const hyHistory = [];
  const dgs10History = [];
  const walclImpulseHistory = [];
  const rows = [];

  for (let date = start; date <= end; date = addUtcDays(date, 1)) {
    const latest = Object.fromEntries(
      MACRO_SERIES.map(([seriesId]) => [seriesId, valueOnOrBefore(bySeries[seriesId], date)])
    );
    if (!MACRO_SERIES.every(([seriesId]) => latest[seriesId])) continue;

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
      source: 'FRED ALFRED observations API',
      fetchedAt,
      latestSourceDate: date,
      availableAfter: isoAfterLag(date),
      metrics: Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value))),
      observedDates: Object.fromEntries(Object.entries(latest).map(([seriesId, row]) => [seriesId, row.asOfDate])),
      timing: {
        conservativeAvailableAfter: isoAfterLag(date),
        conservativeLagDays: CONSERVATIVE_LAG_DAYS,
        realtimeStart: observedAt,
      },
      missingMetrics: Object.entries(metrics).filter(([, value]) => !Number.isFinite(value)).map(([key]) => key),
    });
    hyHistory.push(hySpread);
    dgs10History.push(dgs10);
    if (Number.isFinite(walclChange13w)) walclImpulseHistory.push(walclChange13w);
  }

  const existingRows = readExistingRows();
  const mergedRows = mergeByKey(existingRows, rows, 'date');
  for (const history of histories) {
    appendVintageRecords(`macro-${history.seriesId}`, history.observations);
  }

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'FRED ALFRED observations API',
      status: mergedRows.length > 0 ? 'available' : 'unavailable',
      fetchedAt,
      series: Object.fromEntries(MACRO_SERIES),
      cadence: 'mixed daily/weekly/monthly aligned to daily last-known values',
      credentialRequired: true,
      conservativeLagDays: CONSERVATIVE_LAG_DAYS,
      freshnessCapDays: SOURCE_FRESHNESS_CAP_DAYS.macro,
      vintageSeries: MACRO_SERIES.map(([seriesId]) => `macro-${seriesId}`),
      vintageObservedAt: 'ALFRED observation realtime_start',
      vintageAcquisition: {
        discovery: 'ALFRED fred/series/vintagedates',
        request: 'ALFRED fred/series/observations with observation_start and realtime_start=realtime_end for each selected vintage date',
        maxRequestsPerSeries: MAX_VINTAGE_REQUESTS_PER_SERIES,
        discoveredVintageDates: Object.fromEntries(histories.map(history => [history.seriesId, history.discoveredVintageDates.length])),
        requestedVintageDates: Object.fromEntries(histories.map(history => [history.seriesId, history.requestedVintageDates])),
        successfulVintageDates: Object.fromEntries(histories.map(history => [history.seriesId, history.successfulVintageDates])),
      },
      limitations: [
        'The first credentialed run discovers official ALFRED vintage dates from 2010-07-17 through today and requests a deterministic bounded set of historical realtime windows per series.',
        'At most 48 snapshots per series are requested on one run; repeated runs append newly observed records and improve coverage without rewriting prior archive bytes.',
        'All macro rows use a conservative 30-day availableAfter lag before feature-table use.',
        'Macro fields remain context-only until the pre-registered recovered-history experiment passes its out-of-sample gate.',
      ],
      docs: {
        observations: ALFRED_OBSERVATIONS_URL,
      },
    },
    rows: mergedRows,
  }, null, 2)}\n`);

  console.log([
    '[Macro data] updated',
    `rows=${mergedRows.length}`,
    `incomingRows=${rows.length}`,
    `first=${mergedRows[0]?.date ?? 'n/a'}`,
    `last=${mergedRows.at(-1)?.date ?? 'n/a'}`,
    `series=${MACRO_SERIES.map(([seriesId]) => seriesId).join(',')}`,
    `vintageRequests=${histories.reduce((sum, history) => sum + history.successfulVintageDates.length, 0)}`,
    `source=FRED ALFRED observations API`,
    `path=${OUT_PATH}`,
  ].join('  '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(`[Macro data] FAILED: ${err.message}`);
    process.exitCode = 1;
  });
}
