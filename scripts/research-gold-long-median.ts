/**
 * Long-horizon gold median study behind GOLD_MOMENTUM_DAYS and
 * GOLD_LONG_RUN_DRIFT in src/lib/marketForecast.ts.
 *
 *   npx tsx scripts/research-gold-long-median.ts --csv <monthly.csv>
 *
 * Reads monthly spot gold closes (`Date,Price` rows, source
 * datahub.io/core/gold-prices) from 1972 on. Momentum is the production
 * calendar-day drift. Candidates B-E cap it at one year and continue with an
 * expanding mean, zero, or 4%/yr. Score: MAE of the log return against the
 * incumbent A at 12/24/60/120 months, with Newey-West t on the per-origin
 * error difference, for origins 1975-2003 and 2004+.
 */
import { readFileSync } from 'node:fs';

const csvIndex = process.argv.indexOf('--csv');
if (csvIndex < 0 || !process.argv[csvIndex + 1]) {
  throw new Error('usage: npx tsx scripts/research-gold-long-median.ts --csv <monthly.csv>');
}
const rows = readFileSync(process.argv[csvIndex + 1], 'utf8').trim().split('\n').slice(1)
  .map((l) => { const [d, p] = l.split(','); return { date: d, p: Number(p) }; })
  .filter((r) => r.date >= '1972-01');
const lp = rows.map((r) => Math.log(r.p));
// per-calendar-day momentum drift, monthly approximation of production: 0.25*ret252/252 + 0.25*ret504/504 per session, applied per calendar day
const mom = (i: number) => Math.max(-0.0006, Math.min(0.0006, 0.25 * (lp[i] - lp[i - 12]) / 252 + 0.25 * (lp[i] - lp[i - 24]) / 504));
const expDay = (i: number) => (lp[i] - lp[0]) / (i * 30.44); // expanding mean log return per calendar day since 1972
const cands: Record<string, (i: number, d: number) => number> = {
  'A momentum forever (incumbent)': (i, d) => mom(i) * d,
  'B mom 1y then expanding mean': (i, d) => mom(i) * Math.min(d, 365) + expDay(i) * Math.max(0, d - 365),
  'C mom 1y then zero': (i, d) => mom(i) * Math.min(d, 365),
  'D expanding mean only': (i, d) => expDay(i) * d,
  'E mom 1y then 4%/yr': (i, d) => mom(i) * Math.min(d, 365) + Math.log(1.04) / 365 * Math.max(0, d - 365),
};
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
function neweyWestT(values: number[], lag: number): number {
  const n = values.length;
  const avg = mean(values);
  const c = values.map((v) => v - avg);
  let lrv = c.reduce((s, v) => s + v * v, 0) / n;
  for (let k = 1; k <= Math.min(lag, n - 1); k++) {
    let cov = 0;
    for (let t = k; t < n; t++) cov += c[t] * c[t - k];
    lrv += 2 * (1 - k / (lag + 1)) * (cov / n);
  }
  return lrv > 0 ? avg / Math.sqrt(lrv / n) : 0;
}
for (const [lo, hi] of [['1975-01', '2004-01'], ['2004-01', '9999']]) {
  console.log(`--- origins ${lo}..${hi}`);
  for (const months of [12, 24, 60, 120]) {
    const d = Math.round(months * 30.44);
    const idx = rows.map((_, i) => i).filter((i) => i >= 24 && rows[i].date >= lo && rows[i].date < hi && i + months < rows.length);
    const base = idx.map((i) => Math.abs(lp[i + months] - lp[i] - cands['A momentum forever (incumbent)'](i, d)));
    const line = Object.entries(cands).map(([name, f]) => {
      const e = idx.map((i) => Math.abs(lp[i + months] - lp[i] - f(i, d)));
      return `${name.split(' ')[0]}:${mean(e).toFixed(3)}${name.startsWith('A') ? '' : `(${((1 - mean(e) / mean(base)) * 100).toFixed(0)}%,t${neweyWestT(base.map((x, k) => x - e[k]), months).toFixed(1)})`}`;
    }).join('  ');
    console.log(`h=${String(months).padStart(3)}m n=${idx.length} MAE ${line}`);
  }
}
console.log('expanding mean at 2026-10: %/yr', ((Math.exp(expDay(rows.length - 1) * 365) - 1) * 100).toFixed(1), ' momentum now %/yr', ((Math.exp(mom(rows.length - 1) * 365) - 1) * 100).toFixed(1));
