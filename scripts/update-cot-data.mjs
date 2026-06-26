#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/cot-history.json');
const BASE_URL = 'https://publicreporting.cftc.gov/resource/gpe5-46if.json';
const CONTRACTS = [
  { code: '133741', name: 'BITCOIN', btcPerContract: 5 },
  { code: '133742', name: 'MICRO BITCOIN', btcPerContract: 0.1 },
];
const START_DATE = '2018-01-01';
const MS_PER_DAY = 86400000;

function dateKey(value) {
  return new Date(value).toISOString().split('T')[0];
}

function startOfUtcDay(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addUtcDays(date, days) {
  return new Date(startOfUtcDay(date) + days * MS_PER_DAY).toISOString().split('T')[0];
}

function availableAfterForReportDate(date) {
  return new Date(startOfUtcDay(addUtcDays(date, 4))).toISOString();
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchContract(contract) {
  const rows = [];
  let offset = 0;
  while (true) {
    const url = new URL(BASE_URL);
    url.searchParams.set('$limit', '50000');
    url.searchParams.set('$offset', String(offset));
    url.searchParams.set('$order', 'report_date_as_yyyy_mm_dd ASC');
    url.searchParams.set('$where', `cftc_contract_market_code='${contract.code}' AND report_date_as_yyyy_mm_dd >= '${START_DATE}T00:00:00'`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CFTC ${contract.code} failed: ${res.status} ${res.statusText}`);
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < 50000) break;
    offset += chunk.length;
  }
  return rows.map(row => normalizeContractRow(row, contract));
}

function normalizeContractRow(row, contract) {
  const date = dateKey(row.report_date_as_yyyy_mm_dd);
  const scale = contract.btcPerContract;
  return {
    date,
    contractCode: contract.code,
    contractName: contract.name,
    btcPerContract: scale,
    openInterestBtc: num(row.open_interest_all) * scale,
    leveragedMoneyLongBtc: num(row.lev_money_positions_long) * scale,
    leveragedMoneyShortBtc: num(row.lev_money_positions_short) * scale,
    assetManagerLongBtc: num(row.asset_mgr_positions_long) * scale,
    assetManagerShortBtc: num(row.asset_mgr_positions_short) * scale,
    dealerLongBtc: num(row.dealer_positions_long_all) * scale,
    dealerShortBtc: num(row.dealer_positions_short_all) * scale,
    openInterestContracts: num(row.open_interest_all),
  };
}

function percentile(prior, value) {
  const finite = prior.filter(Number.isFinite);
  if (finite.length < 52 || !Number.isFinite(value)) return null;
  return finite.filter(item => item <= value).length / finite.length;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const contractRows = (await Promise.all(CONTRACTS.map(fetchContract))).flat();
  const byDate = new Map();
  for (const row of contractRows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }

  const levNetPctHistory = [];
  const assetMgrNetPctHistory = [];
  const dealerNetPctHistory = [];
  const oiHistory = [];
  const rows = [];

  for (const date of [...byDate.keys()].sort()) {
    const parts = byDate.get(date);
    const openInterestBtc = parts.reduce((sum, row) => sum + row.openInterestBtc, 0);
    if (openInterestBtc <= 0) continue;
    const leveragedMoneyLongBtc = parts.reduce((sum, row) => sum + row.leveragedMoneyLongBtc, 0);
    const leveragedMoneyShortBtc = parts.reduce((sum, row) => sum + row.leveragedMoneyShortBtc, 0);
    const assetManagerLongBtc = parts.reduce((sum, row) => sum + row.assetManagerLongBtc, 0);
    const assetManagerShortBtc = parts.reduce((sum, row) => sum + row.assetManagerShortBtc, 0);
    const dealerLongBtc = parts.reduce((sum, row) => sum + row.dealerLongBtc, 0);
    const dealerShortBtc = parts.reduce((sum, row) => sum + row.dealerShortBtc, 0);
    const leveragedMoneyNetBtc = leveragedMoneyLongBtc - leveragedMoneyShortBtc;
    const assetManagerNetBtc = assetManagerLongBtc - assetManagerShortBtc;
    const dealerNetBtc = dealerLongBtc - dealerShortBtc;
    const leveragedMoneyNetPctOi = leveragedMoneyNetBtc / openInterestBtc;
    const assetManagerNetPctOi = assetManagerNetBtc / openInterestBtc;
    const dealerNetPctOi = dealerNetBtc / openInterestBtc;
    const openInterestChange4w = oiHistory.length >= 4 ? openInterestBtc / oiHistory.at(-4) - 1 : null;

    const metrics = {
      openInterestBtc,
      leveragedMoneyLongBtc,
      leveragedMoneyShortBtc,
      leveragedMoneyNetBtc,
      leveragedMoneyNetPctOi,
      leveragedMoneyNetPctRank: percentile(levNetPctHistory, leveragedMoneyNetPctOi),
      assetManagerLongBtc,
      assetManagerShortBtc,
      assetManagerNetBtc,
      assetManagerNetPctOi,
      assetManagerNetPctRank: percentile(assetMgrNetPctHistory, assetManagerNetPctOi),
      dealerLongBtc,
      dealerShortBtc,
      dealerNetBtc,
      dealerNetPctOi,
      dealerNetPctRank: percentile(dealerNetPctHistory, dealerNetPctOi),
      openInterestChange4w,
      openInterestPctRank: percentile(oiHistory, openInterestBtc),
    };

    rows.push({
      date,
      source: 'CFTC TFF Futures Only public reporting',
      fetchedAt,
      latestSourceDate: date,
      availableAfter: availableAfterForReportDate(date),
      metrics: Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value))),
      contracts: parts.map(row => ({
        code: row.contractCode,
        name: row.contractName,
        btcPerContract: row.btcPerContract,
        openInterestContracts: row.openInterestContracts,
      })),
      timing: {
        reportDate: `${date}T00:00:00.000Z`,
        conservativeAvailableAfter: availableAfterForReportDate(date),
      },
      missingMetrics: [],
    });

    levNetPctHistory.push(leveragedMoneyNetPctOi);
    assetMgrNetPctHistory.push(assetManagerNetPctOi);
    dealerNetPctHistory.push(dealerNetPctOi);
    oiHistory.push(openInterestBtc);
  }

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'CFTC TFF Futures Only public reporting',
      status: rows.length > 0 ? 'available' : 'unavailable',
      fetchedAt,
      dataset: BASE_URL,
      contracts: CONTRACTS,
      fields: [
        'openInterestBtc',
        'leveragedMoneyNetPctOi',
        'leveragedMoneyNetPctRank',
        'assetManagerNetPctOi',
        'assetManagerNetPctRank',
        'dealerNetPctOi',
        'dealerNetPctRank',
        'openInterestChange4w',
        'openInterestPctRank',
      ],
      cadence: 'weekly',
      credentialRequired: false,
      limitations: [
        'CFTC report dates are Tuesday and publication is later in the week; rows use a conservative Saturday 00:00 UTC availableAfter.',
        'BTC and Micro BTC positions are aggregated in BTC-equivalent contract exposure using fixed contract sizes.',
        'This cache is context-only until a COT event study passes out-of-sample validation.',
      ],
      docs: {
        disaggregatedFuturesOnly: 'https://publicreporting.cftc.gov/stories/s/Disaggregated-Futures-Only/ubmb-6exi/',
      },
    },
    rows,
  }, null, 2)}\n`);

  console.log([
    '[COT data] updated',
    `rows=${rows.length}`,
    `first=${rows[0]?.date ?? 'n/a'}`,
    `last=${rows.at(-1)?.date ?? 'n/a'}`,
    `source=CFTC TFF Futures Only`,
    `path=${OUT_PATH}`,
  ].join('  '));
}

main().catch(err => {
  const fetchedAt = new Date().toISOString();
  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'CFTC TFF Futures Only public reporting',
      status: 'unavailable',
      fetchedAt,
      dataset: BASE_URL,
      contracts: CONTRACTS,
      fields: ['openInterestBtc'],
      cadence: 'weekly',
      credentialRequired: false,
      note: `Fetch failed: ${err.message}`,
    },
    rows: [],
  }, null, 2)}\n`);
  console.error(`[COT data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
