#!/usr/bin/env node
/**
 * Fetches no-key daily OHLCV data for market proxies used by the tab workspace.
 * VOO and GLD are sourced from Yahoo Finance's chart endpoint as investable
 * proxies. OHLC values are adjusted by the adjusted-close ratio.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOO_DATA_PATH = join(__dirname, '../src/data/voo-history.json');
const GLD_DATA_PATH = join(__dirname, '../src/data/gld-history.json');
const VOO_FIRST_TRADE_DATE = '2010-09-09';
const GLD_FIRST_TRADE_DATE = '2004-11-18';

const MARKET_SERIES = [
  { label: 'VOO', symbol: 'VOO', firstTradeDate: VOO_FIRST_TRADE_DATE, dataPath: VOO_DATA_PATH },
  { label: 'GLD', symbol: 'GLD', firstTradeDate: GLD_FIRST_TRADE_DATE, dataPath: GLD_DATA_PATH },
];

function isValidRow(row) {
  return /^\d{4}-\d{2}-\d{2}$/.test(row.date)
    && row.open > 0
    && row.high >= row.low
    && row.high >= row.open
    && row.high >= row.close
    && row.low <= row.open
    && row.low <= row.close
    && row.volume >= 0;
}

function validateSortedRows(rows) {
  if (rows.length === 0) throw new Error('no rows returned');

  for (let i = 0; i < rows.length; i++) {
    if (!isValidRow(rows[i])) throw new Error(`malformed row at index ${i}: ${JSON.stringify(rows[i])}`);
    if (i > 0 && rows[i - 1].date >= rows[i].date) {
      throw new Error(`rows are not strictly sorted at ${rows[i - 1].date} -> ${rows[i].date}`);
    }
  }
}

async function fetchYahooRows({ symbol, firstTradeDate }) {
  const period1 = Math.floor(new Date(`${firstTradeDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  const adjClose = result?.indicators?.adjclose?.[0]?.adjclose || [];
  if (!quote || timestamps.length === 0) throw new Error(`Yahoo chart response did not include ${symbol} candles`);

  const rows = timestamps.flatMap((timestamp, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const adjustedClose = adjClose[index];
    const volume = quote.volume?.[index];
    if (![open, high, low, close, adjustedClose, volume].every(Number.isFinite) || close <= 0) return [];

    const adjustment = adjustedClose > 0 ? adjustedClose / close : 1;
    return [{
      date: new Date(timestamp * 1000).toISOString().split('T')[0],
      open: +(open * adjustment).toFixed(4),
      high: +(high * adjustment).toFixed(4),
      low: +(low * adjustment).toFixed(4),
      close: +adjustedClose.toFixed(4),
      volume: Math.round(volume),
    }];
  });

  validateSortedRows(rows);
  return rows;
}

function readCachedRows(dataPath) {
  if (!existsSync(dataPath)) return [];
  try {
    const rows = JSON.parse(readFileSync(dataPath, 'utf8'));
    validateSortedRows(rows);
    return rows;
  } catch {
    return [];
  }
}

async function main() {
  let failures = 0;

  for (const series of MARKET_SERIES) {
    try {
      const rows = await fetchYahooRows(series);
      const tempPath = `${series.dataPath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(rows));
      renameSync(tempPath, series.dataPath);

      const latest = rows[rows.length - 1];
      console.log(`[Market data] ${series.label} rows=${rows.length} latest=${latest.date} close=${latest.close}`);
    } catch (err) {
      const cached = readCachedRows(series.dataPath);
      if (cached.length > 0) {
        const latest = cached[cached.length - 1];
        console.warn(`[Market data] ${series.label} update skipped, using cached rows=${cached.length} latest=${latest.date}: ${err.message}`);
        continue;
      }

      console.error(`[Market data] ${series.label} update failed and no valid cache exists: ${err.message}`);
      failures++;
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
