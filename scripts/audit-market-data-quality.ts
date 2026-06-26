import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SourceAudit {
  id: string;
  label: string;
  status: 'available' | 'unavailable';
  sourceUrl: string;
  error?: string;
  rows: number;
  firstDate: string | null;
  latestDate: string | null;
  overlapDays: number;
  missingOverlapDays: number;
  ohlcViolations: number;
  closeDiffPct: {
    median: number | null;
    p95: number | null;
    max: number | null;
    countAbove1Pct: number;
    countAbove5Pct: number;
  };
  volumeCorrelation: number | null;
  volumeRatio: {
    median: number | null;
    p95: number | null;
  };
  notes: string[];
}

const CANONICAL_ROWS = btcHistory as OHLCVData[];
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const MS_PER_DAY = 86400000;
const AUDIT_LOOKBACK_DAYS = 365;
const LARGE_CLOSE_DIFF_PCT = 0.01;
const VERY_LARGE_CLOSE_DIFF_PCT = 0.05;

function main(): void {
  run().catch(err => {
    console.error(`[Market data audit] FAILED: ${err.message}`);
    process.exitCode = 1;
  });
}

async function run(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const latestCanonicalDate = CANONICAL_ROWS.at(-1)?.date;
  if (!latestCanonicalDate) throw new Error('canonical BTC history is empty');
  const startDate = addUtcDays(latestCanonicalDate, -(AUDIT_LOOKBACK_DAYS - 1));
  const endDate = latestCanonicalDate;

  const sourceResults = await Promise.all([
    auditSource('binance-btcusdt', 'Binance spot BTCUSDT 1d klines', 'https://api.binance.com/api/v3/klines', () => fetchBinance(startDate, endDate), startDate, endDate),
    auditSource('coinbase-btc-usd', 'Coinbase Exchange BTC-USD 1d candles', 'https://api.exchange.coinbase.com/products/BTC-USD/candles', () => fetchCoinbase(startDate, endDate), startDate, endDate),
    auditSource('kraken-xbtusd', 'Kraken XBT/USD 1d OHLC', 'https://api.kraken.com/0/public/OHLC', () => fetchKraken(startDate), startDate, endDate),
  ]);

  const report = {
    generatedAt,
    data: {
      canonicalSource: 'src/data/btc-history.json',
      canonicalMethodology: 'CoinGecko hourly market_chart prices for OHLC and daily total_volumes snapshots for volume',
      canonicalRows: CANONICAL_ROWS.length,
      canonicalFirstDate: CANONICAL_ROWS[0]?.date,
      canonicalLatestDate: latestCanonicalDate,
      auditStartDate: startDate,
      auditEndDate: endDate,
      auditLookbackDays: AUDIT_LOOKBACK_DAYS,
    },
    preRegistration: {
      purpose: 'Data-quality audit before any exchange-volume forecast experiment.',
      checks: [
        'UTC daily close difference versus canonical cache',
        'OHLC consistency violations',
        'overlap/missing-day behavior',
        'volume correlation and volume ratio versus canonical volume',
      ],
      promotionPolicy: 'This audit cannot promote a forecast feature. It can only document whether exchange candles are stable enough to support a separate pre-registered volume-feature ablation.',
    },
    sources: sourceResults,
    verdict: classifyOverall(sourceResults),
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-market-data-quality-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-market-data-quality-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC market data quality report: ${jsonPath}`);
  console.log(`BTC market data quality markdown: ${mdPath}`);
  for (const source of sourceResults) {
    console.log(`${source.id} status=${source.status} overlap=${source.overlapDays} medianCloseDiff=${fmtPct(source.closeDiffPct.median)} p95=${fmtPct(source.closeDiffPct.p95)} volumeCorr=${fmtNum(source.volumeCorrelation)}`);
  }
}

async function auditSource(
  id: string,
  label: string,
  sourceUrl: string,
  fetcher: () => Promise<Candle[]>,
  startDate: string,
  endDate: string
): Promise<SourceAudit> {
  try {
    const rows = (await fetcher()).sort((a, b) => a.date.localeCompare(b.date));
    const byDate = new Map(rows.map(row => [row.date, row]));
    const canonicalWindow = CANONICAL_ROWS.filter(row => row.date >= startDate && row.date <= endDate);
    const closeDiffs: number[] = [];
    const canonicalVolumes: number[] = [];
    const sourceVolumes: number[] = [];
    const volumeRatios: number[] = [];
    let missingOverlapDays = 0;
    let ohlcViolations = 0;

    for (const row of rows) {
      if (!isConsistentOhlc(row)) ohlcViolations++;
    }

    for (const canonical of canonicalWindow) {
      const candidate = byDate.get(canonical.date);
      if (!candidate) {
        missingOverlapDays++;
        continue;
      }
      if (candidate.close > 0 && canonical.close > 0) {
        closeDiffs.push(Math.abs(candidate.close / canonical.close - 1));
      }
      if (candidate.volume > 0 && canonical.volume > 0) {
        canonicalVolumes.push(canonical.volume);
        sourceVolumes.push(candidate.volume);
        volumeRatios.push(candidate.volume / canonical.volume);
      }
    }

    return {
      id,
      label,
      status: 'available',
      sourceUrl,
      rows: rows.length,
      firstDate: rows[0]?.date ?? null,
      latestDate: rows.at(-1)?.date ?? null,
      overlapDays: closeDiffs.length,
      missingOverlapDays,
      ohlcViolations,
      closeDiffPct: {
        median: quantile(closeDiffs, 0.5),
        p95: quantile(closeDiffs, 0.95),
        max: closeDiffs.length ? Math.max(...closeDiffs) : null,
        countAbove1Pct: closeDiffs.filter(value => value > LARGE_CLOSE_DIFF_PCT).length,
        countAbove5Pct: closeDiffs.filter(value => value > VERY_LARGE_CLOSE_DIFF_PCT).length,
      },
      volumeCorrelation: correlation(canonicalVolumes, sourceVolumes),
      volumeRatio: {
        median: quantile(volumeRatios, 0.5),
        p95: quantile(volumeRatios, 0.95),
      },
      notes: sourceNotes(id),
    };
  } catch (err) {
    return {
      id,
      label,
      status: 'unavailable',
      sourceUrl,
      error: err instanceof Error ? err.message : String(err),
      rows: 0,
      firstDate: null,
      latestDate: null,
      overlapDays: 0,
      missingOverlapDays: 0,
      ohlcViolations: 0,
      closeDiffPct: { median: null, p95: null, max: null, countAbove1Pct: 0, countAbove5Pct: 0 },
      volumeCorrelation: null,
      volumeRatio: { median: null, p95: null },
      notes: ['Source unavailable during audit run. Do not use for modeling until reproducibility is restored.'],
    };
  }
}

async function fetchBinance(startDate: string, endDate: string): Promise<Candle[]> {
  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', 'BTCUSDT');
  url.searchParams.set('interval', '1d');
  url.searchParams.set('startTime', String(startOfUtcDay(startDate)));
  url.searchParams.set('endTime', String(startOfUtcDay(addUtcDays(endDate, 1)) - 1));
  url.searchParams.set('limit', '1000');
  const rows = await fetchJson(url);
  if (!Array.isArray(rows)) throw new Error('Unexpected Binance kline payload');
  return rows.map(row => ({
    date: toDateString(Number(row[0])),
    open: finiteNumber(row[1]),
    high: finiteNumber(row[2]),
    low: finiteNumber(row[3]),
    close: finiteNumber(row[4]),
    volume: finiteNumber(row[7]),
  })).filter(isFiniteCandle);
}

async function fetchCoinbase(startDate: string, endDate: string): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const chunkEnd = [addUtcDays(cursor, 299), endDate].sort()[0];
    const url = new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
    url.searchParams.set('granularity', '86400');
    url.searchParams.set('start', `${cursor}T00:00:00Z`);
    url.searchParams.set('end', `${addUtcDays(chunkEnd, 1)}T00:00:00Z`);
    const rows = await fetchJson(url, { 'User-Agent': 'bitcoin-forecast-visualizer market-data-audit' });
    if (!Array.isArray(rows)) throw new Error('Unexpected Coinbase candle payload');
    for (const row of rows) {
      const close = finiteNumber(row[4]);
      const baseVolumeBtc = finiteNumber(row[5]);
      out.push({
        date: toDateString(Number(row[0]) * 1000),
        low: finiteNumber(row[1]),
        high: finiteNumber(row[2]),
        open: finiteNumber(row[3]),
        close,
        volume: close * baseVolumeBtc,
      });
    }
    cursor = addUtcDays(chunkEnd, 1);
  }
  return dedupeCandles(out.filter(isFiniteCandle));
}

async function fetchKraken(startDate: string): Promise<Candle[]> {
  const url = new URL('https://api.kraken.com/0/public/OHLC');
  url.searchParams.set('pair', 'XBTUSD');
  url.searchParams.set('interval', '1440');
  url.searchParams.set('since', String(Math.floor(startOfUtcDay(startDate) / 1000)));
  const payload = await fetchJson(url);
  if (payload.error?.length) throw new Error(`Kraken error: ${payload.error.join(', ')}`);
  const key = Object.keys(payload.result ?? {}).find(item => item !== 'last');
  const rows = key ? payload.result[key] : null;
  if (!Array.isArray(rows)) throw new Error('Unexpected Kraken OHLC payload');
  return rows.map(row => {
    const close = finiteNumber(row[4]);
    const baseVolumeBtc = finiteNumber(row[6]);
    return {
      date: toDateString(Number(row[0]) * 1000),
      open: finiteNumber(row[1]),
      high: finiteNumber(row[2]),
      low: finiteNumber(row[3]),
      close,
      volume: close * baseVolumeBtc,
    };
  }).filter(isFiniteCandle);
}

async function fetchJson(url: URL, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.toString()}`);
  return res.json();
}

function classifyOverall(sources: SourceAudit[]): { status: 'source-candidate' | 'needs-review' | 'blocked'; summary: string } {
  const available = sources.filter(source => source.status === 'available' && source.overlapDays >= 250);
  const stable = available.filter(source =>
    (source.closeDiffPct.p95 ?? Infinity) <= 0.01 &&
    source.ohlcViolations === 0 &&
    (source.volumeCorrelation ?? -Infinity) >= 0.5
  );
  if (stable.length >= 2) {
    return {
      status: 'source-candidate',
      summary: 'Multiple exchange sources have enough overlap and close agreement for a separate pre-registered volume-feature ablation; no forecast feature is promoted by this audit alone.',
    };
  }
  if (available.length > 0) {
    return {
      status: 'needs-review',
      summary: 'At least one source is available, but close/volume agreement is not strong enough to treat exchange volume as model-ready without manual review.',
    };
  }
  return {
    status: 'blocked',
    summary: 'No candidate exchange source was available with sufficient overlap during this run.',
  };
}

function renderMarkdown(report: any): string {
  const lines = [
    '# BTC Market Data Quality And Volume Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Setup',
    '',
    `- Canonical cache: ${report.data.canonicalSource}`,
    `- Canonical latest date: ${report.data.canonicalLatestDate}`,
    `- Audit window: ${report.data.auditStartDate} through ${report.data.auditEndDate}`,
    `- Purpose: ${report.preRegistration.purpose}`,
    `- Promotion policy: ${report.preRegistration.promotionPolicy}`,
    '',
    '## Verdict',
    '',
    `- Status: **${report.verdict.status}**`,
    `- Summary: ${report.verdict.summary}`,
    '',
    '## Source summary',
    '',
  ];
  for (const source of report.sources as SourceAudit[]) {
    lines.push(`### ${source.label}`);
    lines.push('');
    lines.push(`- Status: ${source.status}`);
    if (source.error) lines.push(`- Error: ${source.error}`);
    lines.push(`- Rows: ${source.rows}, first=${source.firstDate ?? 'n/a'}, latest=${source.latestDate ?? 'n/a'}, overlap=${source.overlapDays}, missing=${source.missingOverlapDays}`);
    lines.push(`- Close diff: median=${fmtPct(source.closeDiffPct.median)}, p95=${fmtPct(source.closeDiffPct.p95)}, max=${fmtPct(source.closeDiffPct.max)}, >1%=${source.closeDiffPct.countAbove1Pct}, >5%=${source.closeDiffPct.countAbove5Pct}`);
    lines.push(`- OHLC violations: ${source.ohlcViolations}`);
    lines.push(`- Volume: correlation=${fmtNum(source.volumeCorrelation)}, median ratio=${fmtNum(source.volumeRatio.median)}, p95 ratio=${fmtNum(source.volumeRatio.p95)}`);
    for (const note of source.notes) lines.push(`- Note: ${note}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function sourceNotes(id: string): string[] {
  if (id === 'binance-btcusdt') return ['BTCUSDT is a USDT quote market, not BTC/USD spot; close agreement is useful but not a canonical USD replacement by itself.', 'Volume is quote volume in USDT and is not directly comparable to CoinGecko aggregate USD volume.'];
  if (id === 'coinbase-btc-usd') return ['Coinbase is BTC/USD spot with exchange-specific base BTC volume converted to approximate USD using daily close; it is useful for source-methodology drift checks but not total market volume.'];
  if (id === 'kraken-xbtusd') return ['Kraken is BTC/USD spot with exchange-specific base BTC volume converted to approximate USD using daily close and may return a limited recent history window.'];
  return [];
}

function dedupeCandles(rows: Candle[]): Candle[] {
  return [...new Map(rows.map(row => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

function isConsistentOhlc(row: Candle): boolean {
  return row.high >= row.low &&
    row.high >= row.open &&
    row.high >= row.close &&
    row.low <= row.open &&
    row.low <= row.close &&
    row.open > 0 &&
    row.close > 0 &&
    row.volume >= 0;
}

function isFiniteCandle(row: Candle): boolean {
  return Boolean(row.date) &&
    Number.isFinite(row.open) &&
    Number.isFinite(row.high) &&
    Number.isFinite(row.low) &&
    Number.isFinite(row.close) &&
    Number.isFinite(row.volume);
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function correlation(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const meanA = mean(a);
  const meanB = mean(b);
  if (meanA === null || meanB === null) return null;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom > 0 ? numerator / denom : null;
}

function quantile(values: number[], q: number): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const index = Math.min(finite.length - 1, Math.max(0, Math.floor((finite.length - 1) * q)));
  return finite[index];
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function startOfUtcDay(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addUtcDays(date: string, days: number): string {
  return toDateString(startOfUtcDay(date) + days * MS_PER_DAY);
}

function toDateString(value: number): string {
  return new Date(value).toISOString().split('T')[0];
}

function fmtPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function fmtNum(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

main();
