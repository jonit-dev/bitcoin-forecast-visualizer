import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BTC_DATA_PATH = join(__dirname, '../src/data/btc-history.json');
const MVRV_DATA_PATH = join(__dirname, '../src/data/mvrv-history.json');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function toDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function daysBetween(a, b) {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / MS_PER_DAY);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function formatPct(value) {
  return `${(value * 100).toFixed(4)}%`;
}

async function fetchCoinMetricsMvrv(startDate, endDate) {
  const rows = [];
  let url =
    'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics' +
    `?assets=btc&metrics=CapMVRVCur,CapMrktCurUSD&frequency=1d&start_time=${startDate}&end_time=${endDate}&page_size=10000`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinMetrics request failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    for (const row of json.data || []) {
      if (!row.CapMVRVCur || !row.CapMrktCurUSD) continue;
      rows.push({
        date: row.time.split('T')[0],
        mvrv: Number(Number(row.CapMVRVCur).toFixed(4)),
        marketCap: Math.round(Number(row.CapMrktCurUSD)),
      });
    }
    url = json.next_page_url || null;
  }

  return rows;
}

function validateLocalShape(btcRows, mvrvRows) {
  assert(Array.isArray(mvrvRows), 'MVRV data is not an array');
  assert(mvrvRows.length > 365, `MVRV data has too few rows: ${mvrvRows.length}`);

  const btcDates = new Set(btcRows.map((row) => row.date));
  const seen = new Set();
  let previousDate = null;
  let minMvrv = Infinity;
  let maxMvrv = -Infinity;
  let minImpliedSupply = Infinity;
  let maxImpliedSupply = -Infinity;

  for (const row of mvrvRows) {
    assert(typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date), `Bad date: ${row.date}`);
    assert(!seen.has(row.date), `Duplicate MVRV date: ${row.date}`);
    assert(Number.isFinite(row.mvrv) && row.mvrv > 0, `Bad MVRV on ${row.date}: ${row.mvrv}`);
    assert(Number.isFinite(row.marketCap) && row.marketCap > 0, `Bad marketCap on ${row.date}: ${row.marketCap}`);
    assert(btcDates.has(row.date), `MVRV date is missing from BTC history: ${row.date}`);

    if (previousDate) {
      const gap = daysBetween(previousDate, row.date);
      assert(gap === 1, `MVRV date gap between ${previousDate} and ${row.date}: ${gap} days`);
    }

    const btc = btcRows.find((point) => point.date === row.date);
    const impliedSupply = row.marketCap / btc.close;
    if (row.marketCap > 10_000_000_000) {
      assert(impliedSupply > 5_000_000 && impliedSupply < 25_000_000, `Implausible implied supply on ${row.date}: ${impliedSupply}`);
    }

    seen.add(row.date);
    previousDate = row.date;
    minMvrv = Math.min(minMvrv, row.mvrv);
    maxMvrv = Math.max(maxMvrv, row.mvrv);
    minImpliedSupply = Math.min(minImpliedSupply, impliedSupply);
    maxImpliedSupply = Math.max(maxImpliedSupply, impliedSupply);
  }

  return {
    rows: mvrvRows.length,
    firstDate: mvrvRows[0].date,
    lastDate: mvrvRows.at(-1).date,
    minMvrv,
    maxMvrv,
    minImpliedSupply,
    maxImpliedSupply,
  };
}

function compareToUpstream(localRows, upstreamRows) {
  const upstreamByDate = new Map(upstreamRows.map((row) => [row.date, row]));
  const mismatches = [];
  const missing = [];
  let maxMvrvDiff = 0;
  let maxMarketCapRelDiff = 0;

  for (const local of localRows) {
    const upstream = upstreamByDate.get(local.date);
    if (!upstream) {
      missing.push(local.date);
      continue;
    }

    const mvrvDiff = Math.abs(local.mvrv - upstream.mvrv);
    const marketCapRelDiff = Math.abs(local.marketCap - upstream.marketCap) / upstream.marketCap;
    maxMvrvDiff = Math.max(maxMvrvDiff, mvrvDiff);
    maxMarketCapRelDiff = Math.max(maxMarketCapRelDiff, marketCapRelDiff);

    if (mvrvDiff > 0.0001 || marketCapRelDiff > 0.000001) {
      mismatches.push({ date: local.date, local, upstream, mvrvDiff, marketCapRelDiff });
    }
  }

  return {
    upstreamRows: upstreamRows.length,
    missing,
    mismatches,
    maxMvrvDiff,
    maxMarketCapRelDiff,
  };
}

async function main() {
  const btcRows = parseJson(BTC_DATA_PATH);
  const mvrvRows = parseJson(MVRV_DATA_PATH);
  const local = validateLocalShape(btcRows, mvrvRows);

  console.log('[MVRV validation] Local shape OK');
  console.log(
    [
      `rows=${local.rows}`,
      `first=${local.firstDate}`,
      `last=${local.lastDate}`,
      `minMVRV=${local.minMvrv.toFixed(4)}`,
      `maxMVRV=${local.maxMvrv.toFixed(4)}`,
      `impliedSupplyRange=${Math.round(local.minImpliedSupply).toLocaleString()}-${Math.round(local.maxImpliedSupply).toLocaleString()}`,
    ].join('  ')
  );

  const upstreamRows = await fetchCoinMetricsMvrv(local.firstDate, local.lastDate);
  const upstream = compareToUpstream(mvrvRows, upstreamRows);

  assert(upstream.missing.length === 0, `CoinMetrics missing ${upstream.missing.length} local dates; first=${upstream.missing[0]}`);
  assert(
    upstream.mismatches.length === 0,
    `CoinMetrics mismatch count=${upstream.mismatches.length}; first=${JSON.stringify(upstream.mismatches[0])}`
  );

  console.log('[MVRV validation] CoinMetrics parity OK');
  console.log(
    [
      `upstreamRows=${upstream.upstreamRows}`,
      `maxMVRVDiff=${upstream.maxMvrvDiff.toFixed(6)}`,
      `maxMarketCapRelDiff=${formatPct(upstream.maxMarketCapRelDiff)}`,
    ].join('  ')
  );
}

main().catch((err) => {
  console.error(`[MVRV validation] FAILED: ${err.message}`);
  process.exitCode = 1;
});
