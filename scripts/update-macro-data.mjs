#!/usr/bin/env node
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRED_OBSERVATION_START,
  fetchFredObservations,
  requireFredApiKey,
} from './lib/fredApi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/macro-history.json');
const CONSERVATIVE_LAG_DAYS = 30;
const Z_SCORE_LOOKBACK = 252;
const MS_PER_DAY = 86400000;
const CORE_SERIES = ['WALCL', 'FEDFUNDS', 'DGS10', 'BAMLH0A0HYM2', 'M2SL'];
const SERIES = [
  ['WALCL', 'Fed balance sheet assets'],
  ['FEDFUNDS', 'Effective federal funds rate'],
  ['DGS10', '10-year Treasury yield'],
  ['BAMLH0A0HYM2', 'US high-yield option-adjusted spread'],
  ['M2SL', 'M2 money stock'],
  ['T10Y2Y', '10-year minus 2-year Treasury yield spread'],
  ['NFCI', 'Chicago Fed National Financial Conditions Index'],
  ['VIXCLS', 'CBOE volatility index'],
  ['BAA10Y', 'Moody\'s Baa corporate bond spread'],
  ['DTWEXBGS', 'Nominal broad US dollar index'],
];

function startOfUtcDay(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addUtcDays(date, days) {
  return new Date(startOfUtcDay(date) + days * MS_PER_DAY).toISOString().split('T')[0];
}

function isoAfterLag(date) {
  return `${addUtcDays(date, CONSERVATIVE_LAG_DAYS)}T00:00:00.000Z`;
}

function valueOnOrBefore(rows, date) {
  let latest = null;
  for (const row of rows) {
    if (row.date > date) break;
    latest = row;
  }
  return latest;
}

function change(rows, date, lookbackDays) {
  const current = valueOnOrBefore(rows, date);
  const prior = valueOnOrBefore(rows, addUtcDays(date, -lookbackDays));
  if (!current || !prior || prior.value === 0) return null;
  return current.value / prior.value - 1;
}

function difference(rows, date, lookbackDays) {
  const current = valueOnOrBefore(rows, date);
  const prior = valueOnOrBefore(rows, addUtcDays(date, -lookbackDays));
  if (!current || !prior) return null;
  return current.value - prior.value;
}

function priorZScore(history, value) {
  const prior = history.filter(Number.isFinite).slice(-Z_SCORE_LOOKBACK);
  if (prior.length < 120 || !Number.isFinite(value)) return null;
  const mean = prior.reduce((sum, item) => sum + item, 0) / prior.length;
  const variance = prior.reduce((sum, item) => sum + (item - mean) ** 2, 0) / prior.length;
  const standardDeviation = Math.sqrt(variance);
  return standardDeviation > 0 ? (value - mean) / standardDeviation : null;
}

function meanFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length >= 2 ? finite.reduce((sum, item) => sum + item, 0) / finite.length : null;
}

async function main() {
  const apiKey = requireFredApiKey();
  const fetchedAt = new Date().toISOString();
  const fetched = await Promise.all(SERIES.map(async ([seriesId]) => [
    seriesId,
    await fetchFredObservations(seriesId, apiKey),
  ]));
  for (const [seriesId, observations] of fetched) {
    if (!Array.isArray(observations) || observations.length === 0) {
      throw new Error(`FRED ${seriesId} returned an empty observation array; existing cache preserved.`);
    }
  }
  const bySeries = Object.fromEntries(fetched);
  const dates = [...new Set(Object.values(bySeries).flat().map(row => row.date))]
    .filter(date => date >= FRED_OBSERVATION_START)
    .sort();
  if (dates.length === 0) throw new Error('FRED returned no finite observations after the requested start date.');

  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  const rows = [];
  const history = new Map([
    ['highYieldSpread', []],
    ['dgs10', []],
    ['walclChange13w', []],
    ['nfci', []],
    ['vix', []],
    ['baaSpread', []],
    ['dollarMomentum30d', []],
    ['yieldCurveInversion', []],
    ['fedFundsChange13w', []],
  ]);

  for (let date = firstDate; date <= lastDate; date = addUtcDays(date, 1)) {
    const latest = Object.fromEntries(
      Object.keys(bySeries)
        .map(seriesId => [seriesId, valueOnOrBefore(bySeries[seriesId], date)])
        .filter(([, row]) => row !== null)
    );
    if (CORE_SERIES.some(seriesId => !latest[seriesId])) continue;

    const walclChange13w = change(bySeries.WALCL, date, 91);
    const walclChange26w = change(bySeries.WALCL, date, 182);
    const fedFundsChange13w = difference(bySeries.FEDFUNDS, date, 91);
    const dgs10Change30d = difference(bySeries.DGS10, date, 30);
    const dgs10Change90d = difference(bySeries.DGS10, date, 90);
    const m2Change26w = change(bySeries.M2SL, date, 182);
    const yieldCurveChange30d = difference(bySeries.T10Y2Y, date, 30);
    const dollarMomentum30d = change(bySeries.DTWEXBGS, date, 30);
    const highYieldSpread = latest.BAMLH0A0HYM2.value;
    const dgs10 = latest.DGS10.value;
    const yieldCurve = latest.T10Y2Y?.value;
    const nfci = latest.NFCI?.value;
    const vix = latest.VIXCLS?.value;
    const baaSpread = latest.BAA10Y?.value;
    const dollarIndex = latest.DTWEXBGS?.value;
    const yieldCurveInversion = Number.isFinite(yieldCurve) ? -yieldCurve : null;

    const highYieldSpreadZ252d = priorZScore(history.get('highYieldSpread'), highYieldSpread);
    const dgs10Z252d = priorZScore(history.get('dgs10'), dgs10);
    const walclImpulseZ252d = priorZScore(history.get('walclChange13w'), walclChange13w);
    const nfciZ252d = priorZScore(history.get('nfci'), nfci);
    const vixZ252d = priorZScore(history.get('vix'), vix);
    const baaSpreadZ252d = priorZScore(history.get('baaSpread'), baaSpread);
    const dollarMomentumZ252d = priorZScore(history.get('dollarMomentum30d'), dollarMomentum30d);
    const yieldCurveInversionZ252d = priorZScore(history.get('yieldCurveInversion'), yieldCurveInversion);
    const fedFundsChangeZ252d = priorZScore(history.get('fedFundsChange13w'), fedFundsChange13w);
    const macroRiskScore = meanFinite([
      highYieldSpreadZ252d,
      dgs10Z252d,
      Number.isFinite(walclImpulseZ252d) ? -walclImpulseZ252d : null,
      fedFundsChangeZ252d,
      yieldCurveInversionZ252d,
    ]);
    const stressScore = meanFinite([
      highYieldSpreadZ252d,
      nfciZ252d,
      vixZ252d,
      baaSpreadZ252d,
      dollarMomentumZ252d,
      yieldCurveInversionZ252d,
    ]);

    const metrics = {
      fedBalanceSheetAssets: latest.WALCL.value,
      fedBalanceSheetChange13w: walclChange13w,
      fedBalanceSheetChange26w: walclChange26w,
      fedFundsRate: latest.FEDFUNDS.value,
      fedFundsChange13w,
      fedFundsChangeZ252d,
      treasury10yYield: dgs10,
      treasury10yChange30d: dgs10Change30d,
      treasury10yChange90d: dgs10Change90d,
      highYieldSpread,
      highYieldSpreadZ252d,
      m2MoneyStock: latest.M2SL.value,
      m2Change26w,
      liquidityImpulseZ252d: walclImpulseZ252d,
      yieldCurve10y2y: yieldCurve,
      yieldCurveChange30d,
      yieldCurveInversion,
      yieldCurveInversionZ252d,
      nfci,
      nfciZ252d,
      vix,
      vixZ252d,
      baaSpread,
      baaSpreadZ252d,
      dollarIndex,
      dollarMomentum30d,
      dollarMomentumZ252d,
      macroRiskScore,
      macroStressScore: stressScore,
      macroHighYieldSpreadZ252d: highYieldSpreadZ252d,
    };
    const observedDates = Object.fromEntries(Object.entries(latest).map(([seriesId, row]) => [seriesId, row.date]));
    const latestSourceDate = Object.values(observedDates).sort().at(-1);
    const cleanMetrics = Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value)));
    const missingMetrics = Object.entries(metrics)
      .filter(([, value]) => !Number.isFinite(value))
      .map(([name]) => name);

    rows.push({
      date,
      source: 'FRED observations API (latest revised observations)',
      fetchedAt,
      latestSourceDate,
      availableAfter: isoAfterLag(latestSourceDate),
      metrics: cleanMetrics,
      observedDates,
      timing: {
        conservativeAvailableAfter: isoAfterLag(latestSourceDate),
        conservativeLagDays: CONSERVATIVE_LAG_DAYS,
        vintage: 'latest-revised FRED data; not an ALFRED vintage',
      },
      missingMetrics,
    });

    for (const [name, value] of [
      ['highYieldSpread', highYieldSpread],
      ['dgs10', dgs10],
      ['walclChange13w', walclChange13w],
      ['nfci', nfci],
      ['vix', vix],
      ['baaSpread', baaSpread],
      ['dollarMomentum30d', dollarMomentum30d],
      ['yieldCurveInversion', yieldCurveInversion],
      ['fedFundsChange13w', fedFundsChange13w],
    ]) {
      if (Number.isFinite(value)) history.get(name).push(value);
    }
  }

  const metadata = {
    source: 'FRED observations API',
    status: rows.length > 0 ? 'available' : 'unavailable',
    fetchedAt,
    series: Object.fromEntries(SERIES),
    observationStart: FRED_OBSERVATION_START,
    cadence: 'mixed daily/weekly/monthly observations aligned to daily last-known values',
    credentialRequired: true,
    conservativeLagDays: CONSERVATIVE_LAG_DAYS,
    vintage: 'latest-revised observations; not an ALFRED vintage',
    limitations: [
      'FRED observations are latest revisions rather than point-in-time ALFRED vintages; all experiment results remain research-only.',
      'Each aligned row is available only after the latest contributing observation plus a conservative 30-day lag.',
    ],
    docs: {
      observationsApi: 'https://api.stlouisfed.org/fred/series/observations',
      fredSeries: 'https://fred.stlouisfed.org/series/SERIES_ID',
    },
  };

  if (rows.length === 0) {
    throw new Error('FRED aligned cache has zero rows; existing cache preserved.');
  }

  writeFileSync(OUT_PATH, `${JSON.stringify({ metadata, rows }, null, 2)}\n`);
  console.log([
    '[Macro data] updated',
    `rows=${rows.length}`,
    `first=${rows[0]?.date ?? 'n/a'}`,
    `last=${rows.at(-1)?.date ?? 'n/a'}`,
    'source=FRED observations API',
    `path=${OUT_PATH}`,
  ].join('  '));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Macro data] FAILED: ${message.replace(/api_key=[^&\s]+/gi, 'api_key=[redacted]')}`);
  process.exitCode = 1;
});
