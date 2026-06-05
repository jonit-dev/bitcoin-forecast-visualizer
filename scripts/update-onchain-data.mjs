#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/onchain-history.json');
const MS_PER_DAY = 86400000;

const SOURCE_METRICS = [
  'CapMVRVCur',
  'CapMrktCurUSD',
  'AdrActCnt',
  'TxCnt',
  'HashRate',
  'SplyCur',
  'FeeTotNtv',
  'IssTotNtv',
  'BlkCnt',
];

const DESIRED_FIELDS = [
  'realizedCapUSD',
  'realizedPriceUSD',
  'mvrv',
  'marketCapUSD',
  'activeAddresses',
  'transactionCount',
  'transferValueUSD',
  'feesUSD',
  'hashRate',
  'difficulty',
  'minerRevenueUSD',
];

function dateKey(value) {
  return new Date(value).toISOString().split('T')[0];
}

function daysBetween(fromDate, toDate) {
  return Math.round((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / MS_PER_DAY);
}

async function fetchCoinMetricsRows() {
  const rows = [];
  let url =
    'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics' +
    `?assets=btc&metrics=${SOURCE_METRICS.join(',')}&frequency=1d&start_time=2010-07-17&page_size=10000`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CoinMetrics on-chain request failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    rows.push(...(json.data || []));
    url = json.next_page_url || null;
  }

  return rows;
}

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRow(row, fetchedAt, latestSourceDate) {
  const date = row.time.split('T')[0];
  const sourceValues = Object.fromEntries(
    SOURCE_METRICS.map(metric => [metric, row[metric] ?? null])
  );
  const mvrv = numberValue(row.CapMVRVCur);
  const marketCapUSD = numberValue(row.CapMrktCurUSD);
  const supply = numberValue(row.SplyCur);
  const priceUSD = marketCapUSD && supply ? marketCapUSD / supply : null;
  const realizedCapUSD = marketCapUSD && mvrv ? marketCapUSD / mvrv : null;
  const realizedPriceUSD = realizedCapUSD && supply ? realizedCapUSD / supply : null;
  const feesNative = numberValue(row.FeeTotNtv);
  const issuanceNative = numberValue(row.IssTotNtv);

  const metrics = {
    realizedCapUSD,
    realizedPriceUSD,
    mvrv,
    marketCapUSD,
    activeAddresses: numberValue(row.AdrActCnt),
    transactionCount: numberValue(row.TxCnt),
    transferValueUSD: null,
    feesUSD: feesNative && priceUSD ? feesNative * priceUSD : null,
    hashRate: numberValue(row.HashRate),
    difficulty: null,
    minerRevenueUSD: issuanceNative && priceUSD ? (issuanceNative + (feesNative ?? 0)) * priceUSD : null,
    supply,
    blockCount: numberValue(row.BlkCnt),
  };

  return {
    date,
    source: 'CoinMetrics Community API',
    fetchedAt,
    latestSourceDate,
    daysLag: daysBetween(latestSourceDate, dateKey(Date.now())),
    metrics,
    missingMetrics: DESIRED_FIELDS.filter(field => metrics[field] === null || metrics[field] === undefined),
    sourceValues,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const sourceRows = await fetchCoinMetricsRows();
  const latestSourceDate = sourceRows.map(row => row.time.split('T')[0]).sort().at(-1);
  const normalized = sourceRows
    .map(row => normalizeRow(row, fetchedAt, latestSourceDate))
    .filter(row => row.metrics.mvrv && row.metrics.marketCapUSD)
    .sort((a, b) => a.date.localeCompare(b.date));

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(normalized)}\n`);

  const missingDates = [];
  for (let i = 1; i < normalized.length; i++) {
    const gap = daysBetween(normalized[i - 1].date, normalized[i].date);
    if (gap !== 1) missingDates.push(`${normalized[i - 1].date}->${normalized[i].date}`);
  }

  console.log(
    [
      '[On-chain data] updated',
      `rows=${normalized.length}`,
      `latestSourceDate=${latestSourceDate}`,
      `daysLag=${normalized.at(-1)?.daysLag ?? 'n/a'}`,
      `missingDateGaps=${missingDates.length}`,
      `source=CoinMetrics Community API`,
    ].join('  ')
  );
}

main().catch(err => {
  console.error(`[On-chain data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
