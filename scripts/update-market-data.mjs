#!/usr/bin/env node
/**
 * Fetches no-key daily OHLCV data for market proxies used by the tab workspace.
 * VOO is sourced from Yahoo Finance's chart endpoint as the first S&P 500
 * investable proxy. OHLC values are adjusted by the adjusted-close ratio.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOO_DATA_PATH = join(__dirname, '../src/data/voo-history.json');
const VOO_FIRST_TRADE_DATE = '2010-09-09';
const VOO_YAHOO_SYMBOL = 'VOO';

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

async function fetchVooRows() {
  const period1 = Math.floor(new Date(`${VOO_FIRST_TRADE_DATE}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${VOO_YAHOO_SYMBOL}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
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
  if (!quote || timestamps.length === 0) throw new Error('Yahoo chart response did not include VOO candles');

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

function readCachedRows() {
  if (!existsSync(VOO_DATA_PATH)) return [];
  try {
    const rows = JSON.parse(readFileSync(VOO_DATA_PATH, 'utf8'));
    validateSortedRows(rows);
    return rows;
  } catch {
    return [];
  }
}

async function main() {
  try {
    const rows = await fetchVooRows();
    const tempPath = `${VOO_DATA_PATH}.tmp`;
    writeFileSync(tempPath, JSON.stringify(rows));
    renameSync(tempPath, VOO_DATA_PATH);

    const latest = rows[rows.length - 1];
    console.log(`[Market data] VOO rows=${rows.length} latest=${latest.date} close=${latest.close}`);
  } catch (err) {
    const cached = readCachedRows();
    if (cached.length > 0) {
      const latest = cached[cached.length - 1];
      console.warn(`[Market data] VOO update skipped, using cached rows=${cached.length} latest=${latest.date}: ${err.message}`);
      return;
    }

    console.error(`[Market data] VOO update failed and no valid cache exists: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
