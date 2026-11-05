/**
 * Parameter search behind SP500_VOL_TERM_STRUCTURE and GOLD_VOL_TERM_STRUCTURE.
 * Fits only on origins before 2019; the 2019+ gate is backtest-market-production.ts.
 *
 *   npx tsx scripts/research-market-volatility.ts [--cache <dir>]
 *
 * Fetches S&P 500 (^GSPC), VIX (^VIX) and gold futures (GC=F) daily closes from
 * Yahoo into the cache directory. GLD and GVZ come from the bundled snapshots.
 * Score: mean over 7/14/30/90/180/365-day horizons of the pinball loss over
 * q05/q10/q50/q90/q95, relative to a 252-day realized vol * sqrt(sessions)
 * reference. Lower is better.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import gldHistory from '../src/data/gld-history.json';
import goldMacroHistory from '../src/data/gold-macro-history.json';
import { termStructureLogVariance } from '../src/lib/marketForecast';

interface Row { date: string; close: number }
const HORIZONS = [7, 14, 30, 90, 180, 365];
const Z = [-1.6448536269514722, -1.2815515655446004, 0, 1.2815515655446004, 1.6448536269514722];
const P = [0.05, 0.1, 0.5, 0.9, 0.95];
const cacheIndex = process.argv.indexOf('--cache');
const CACHE = cacheIndex > 0 ? process.argv[cacheIndex + 1] : path.join(tmpdir(), 'market-vol-research');

async function yahoo(symbol: string): Promise<Row[]> {
  mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${symbol.replace(/[^A-Z]/gi, '')}.json`);
  if (!existsSync(file)) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`${symbol}: ${res.status}`);
    writeFileSync(file, await res.text());
  }
  const result = JSON.parse(readFileSync(file, 'utf8')).chart.result[0];
  const closes = result.indicators.quote[0].close as (number | null)[];
  return result.timestamp.flatMap((ts: number, i: number) =>
    closes[i] && closes[i]! > 0 ? [{ date: new Date(ts * 1000).toISOString().slice(0, 10), close: closes[i]! }] : []);
}

interface Series { dates: string[]; close: number[]; r: number[]; cumSq: number[]; cumR: number[]; ewma: Map<number, number[]>; implied: number[] }

function buildSeries(rows: Row[], impliedRows: Row[] = []): Series {
  const close = rows.map((row) => row.close);
  const r = close.map((c, i) => (i === 0 ? 0 : Math.log(c / close[i - 1])));
  const cumSq: number[] = [];
  const cumR: number[] = [];
  r.reduce((sq, value) => (cumSq.push(sq + value * value), sq + value * value), 0);
  r.reduce((sum, value) => (cumR.push(sum + value), sum + value), 0);
  const ewma = new Map<number, number[]>();
  for (const halfLife of [10, 21, 42, 63, 126]) {
    const lambda = 0.5 ** (1 / halfLife);
    const v = new Array(r.length).fill(NaN);
    v[60] = cumSq[60] / 60; // same seed as ewmaDailyVariance: mean of the first 60 squared returns
    for (let i = 61; i < r.length; i++) v[i] = lambda * v[i - 1] + (1 - lambda) * r[i] * r[i];
    ewma.set(halfLife, v);
  }
  // Implied vol lagged one session: only a value dated before the origin is used.
  const implied = new Array(r.length).fill(NaN);
  for (let i = 0, k = 0; i < rows.length; i++) {
    while (k + 1 < impliedRows.length && impliedRows[k + 1].date < rows[i].date) k++;
    if (impliedRows[k]?.date < rows[i].date) implied[i] = (impliedRows[k].close / 100) ** 2 / 252;
  }
  return { dates: rows.map((row) => row.date), close, r, cumSq, cumR, ewma, implied };
}

interface Origin { i: number; n: number; y: number }

function origins(s: Series, horizon: number, from: string, to: string): Origin[] {
  const out: Origin[] = [];
  const last = s.dates[s.dates.length - 1];
  for (let i = 600, j = 600; i < s.dates.length; i += 5) {
    if (s.dates[i] < from) continue;
    const target = new Date(`${s.dates[i]}T00:00:00Z`);
    target.setUTCDate(target.getUTCDate() + horizon);
    const targetDate = target.toISOString().slice(0, 10);
    if (s.dates[i] >= to || targetDate > last) break;
    j = Math.max(j, i);
    while (j + 1 < s.dates.length && s.dates[j + 1] <= targetDate) j++;
    if (j > i) out.push({ i, n: j - i, y: Math.log(s.close[j] / s.close[i]) });
  }
  return out;
}

function pinball(y: number, m: number, scale: number): number {
  return Z.reduce((sum, z, k) => {
    const d = y - (m + z * scale);
    return sum + Math.max(P[k] * d, (P[k] - 1) * d);
  }, 0) / Z.length;
}

const std = (values: number[]) => {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / (values.length - 1));
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

function spotVariance(s: Series, i: number, source: string): number {
  if (source === 'vol252') return std(s.r.slice(i - 251, i + 1)) ** 2;
  if (source === 'implied') return s.implied[i];
  if (source.startsWith('blend')) return 0.5 * s.ewma.get(Number(source.slice(5)))![i] + 0.5 * s.implied[i];
  return s.ewma.get(Number(source.slice(4)))![i];
}

function longRunVariance(s: Series, i: number, lr: string): number {
  if (lr === 'expanding') return s.cumSq[i] / i;
  if (lr === 'trailing2520') return (s.cumSq[i] - s.cumSq[Math.max(0, i - 2520)]) / Math.min(i, 2520);
  return Number(lr);
}

function search(label: string, s: Series, from: string, sources: string[], median: (o: Origin) => number): void {
  const sets = HORIZONS.map((h) => origins(s, h, from, '2019-01-01'));
  const i2019 = s.dates.findIndex((d) => d >= '2019-01-01');
  const constLr = (s.cumSq[i2019 - 1] - s.cumSq[0]) / (i2019 - 1);
  const reference = sets.map((set) => mean(set.map((o) => pinball(o.y, median(o), std(s.r.slice(o.i - 251, o.i + 1)) * Math.sqrt(o.n)))));
  const results: { name: string; c: number; score: number }[] = [];
  for (const source of sources) for (const lr of ['expanding', 'trailing2520', String(constLr)]) for (const phi of [0.97, 0.98, 0.99, 0.995, 0.998]) {
    let best = { c: 0, score: Infinity };
    for (let c = 0.5; c <= 1.5001; c += 0.02) {
      const score = mean(sets.map((set, k) => mean(set.map((o) =>
        pinball(o.y, median(o), c * Math.sqrt(termStructureLogVariance(spotVariance(s, o.i, source), longRunVariance(s, o.i, lr), phi, o.n))))) / reference[k]));
      if (score < best.score) best = { c, score };
    }
    results.push({ name: `${source} lr=${lr === String(constLr) ? `const(${Math.sqrt(constLr).toFixed(5)})` : lr} phi=${phi}`, ...best });
  }
  results.sort((a, b) => a.score - b.score);
  console.log(`\n${label}: origins ${sets[0].length}/horizon from ${s.dates[sets[0][0].i]}`);
  const print = (r: (typeof results)[number]) => console.log(`  ${r.score.toFixed(4)}  c=${r.c.toFixed(2)}  ${r.name}`);
  results.slice(0, 5).forEach(print);
  console.log('  best price-only:');
  results.filter((r) => !/implied|blend/.test(r.name)).slice(0, 3).forEach(print);
}

async function main(): Promise<void> {
  const gspc = buildSeries(await yahoo('^GSPC'), await yahoo('^VIX'));
  search('S&P 500 index 1991-2018, expanding-mean median', gspc, '1991-01-01',
    ['vol252', 'ewma10', 'ewma21', 'ewma42', 'ewma63', 'implied', 'blend21'], (o) => (gspc.cumR[o.i] / o.i) * o.n);

  const momentum = (s: Series) => (o: Origin) => Math.max(-0.0006, Math.min(0.0006,
    0.25 * Math.log(s.close[o.i] / s.close[o.i - 252]) / 252 + 0.25 * Math.log(s.close[o.i] / s.close[o.i - 504]) / 504)) * o.n;
  const futures = buildSeries(await yahoo('GC=F'));
  search('Gold futures 2002-2018, session momentum median', futures, '2002-06-01',
    ['vol252', 'ewma10', 'ewma21', 'ewma42', 'ewma63'], momentum(futures));

  const gvz = (goldMacroHistory as { rows: { date: string; gvz: number }[] }).rows.map((row) => ({ date: row.date, close: row.gvz }));
  const gld = buildSeries(gldHistory as Row[], gvz);
  search('GLD 2009-2018, session momentum median', gld, '2009-07-01',
    ['vol252', 'ewma21', 'ewma42', 'ewma63', 'implied', 'blend21'], momentum(gld));
}

await main();
