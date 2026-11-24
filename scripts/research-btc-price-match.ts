// Which BTC median forecast actually matches the later real price?
// Report-only study. Pre-registered rules (2026-11-24):
// - Weekly origins from 2017-01-01. Train = origins before 2022-01-01. Test = origins from 2022-01-01.
//   Frozen = origins from 2026-07-06 (commit 2bd91ca: last change to the shipped median formula,
//   constants, tau and strategy), so the shipped model had no hindsight on those origins.
// - Error = |ln(forecast / actual)| (MALE). Lower is better.
// - Moving-average blend weights are picked on Train only, per horizon, from a 0..1 grid (step 0.05).
// - A blend is a positive signal only if, on Test, it cuts its base's MALE by >= 2% at >= 2 horizons
//   AND wins >= 3 of the 5 test years (2022-2026) at those horizons. Anything else is report-only.
import { mkdirSync, writeFileSync } from 'node:fs';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { fitCausalLogPowerLaw, forecastCausalLogPowerLaw } from '../src/lib/btcModelUpgrades';
import { cycleAdjustedPowerLawForecast } from '../src/lib/cycle';

const rows = btcHistory as OHLCVData[];
const HORIZONS = [14, 30, 90, 180, 365];
const TRAIN_START = '2017-01-01';
const TEST_START = '2022-01-01';
const FROZEN_START = '2026-07-06';
const STEP_DAYS = 7;
const GRID = Array.from({ length: 21 }, (_, i) => i / 20);
const parse = (date: string) => new Date(`${date}T00:00:00Z`);

const logClose = rows.map(r => Math.log(r.close));
const prefix = [0];
rows.forEach(r => prefix.push(prefix[prefix.length - 1] + r.close));
const sma = (i: number, n: number) => (i + 1 >= n ? (prefix[i + 1] - prefix[i + 1 - n]) / n : Number.NaN);

type Split = 'train' | 'test' | 'frozen';
interface Sample { date: string; split: Split[]; actual: number; preds: Record<string, number> }

function buildSamples(h: number): Sample[] {
  const samples: Sample[] = [];
  const start = rows.findIndex(r => r.date >= TRAIN_START);
  for (let i = start; i + h < rows.length; i += STEP_DAYS) {
    const date = rows[i].date;
    const origin = parse(date);
    const target = parse(rows[i + h].date);
    const fit = fitCausalLogPowerLaw(rows.slice(0, i + 1), { withCycle: false, startDate: '2013-01-01' });
    if (!fit) continue;
    const drift200 = (logClose[i] - logClose[i - 200]) / 200;
    const preds: Record<string, number> = {
      naive: logClose[i],
      shipped_hindsight: Math.log(cycleAdjustedPowerLawForecast(target, rows[i].close, origin)),
      pit_powerlaw: Math.log(forecastCausalLogPowerLaw(fit, target, rows[i].close, origin)),
      sma20: Math.log(sma(i, 20)),
      sma50: Math.log(sma(i, 50)),
      sma200: Math.log(sma(i, 200)),
      momentum200: logClose[i] + drift200 * h,
    };
    const split: Split[] = [date < TEST_START ? 'train' : 'test'];
    if (date >= FROZEN_START) split.push('frozen');
    samples.push({ date, split, actual: logClose[i + h], preds });
  }
  return samples;
}

const male = (samples: Sample[], key: string) => mean(samples.map(s => Math.abs(s.preds[key] - s.actual)));
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : Number.NaN; };

const BLEND_BASES = ['naive', 'shipped_hindsight', 'pit_powerlaw'];
const BLEND_AVGS = ['sma50', 'sma200'];
const report: any = { generatedAt: new Date().toISOString(), rules: { TRAIN_START, TEST_START, FROZEN_START, STEP_DAYS }, horizons: [] };

for (const h of HORIZONS) {
  const samples = buildSamples(h);
  const train = samples.filter(s => s.split.includes('train'));
  const weights: Record<string, number> = {};
  for (const base of BLEND_BASES) for (const avg of BLEND_AVGS) {
    const key = `${base}+${avg}`;
    let best = { w: 0, err: Infinity };
    for (const w of GRID) {
      const err = mean(train.map(s => Math.abs((1 - w) * s.preds[base] + w * s.preds[avg] - s.actual)));
      if (err < best.err) best = { w, err };
    }
    weights[key] = best.w;
    for (const s of samples) s.preds[key] = (1 - best.w) * s.preds[base] + best.w * s.preds[avg];
  }

  const keys = Object.keys(samples[0].preds);
  const bySplit = (split: Split) => samples.filter(s => s.split.includes(split));
  const testYears = [...new Set(bySplit('test').map(s => s.date.slice(0, 4)))];
  const rowsOut = keys.map(key => {
    const test = bySplit('test');
    const naiveTest = male(test, 'naive');
    const base = key.includes('+') ? key.split('+')[0] : 'naive';
    const yearWinsVsBase = testYears.filter(y => {
      const ys = test.filter(s => s.date.startsWith(y));
      return male(ys, key) < male(ys, base);
    }).length;
    return {
      key,
      weight: weights[key] ?? null,
      trainMALE: male(bySplit('train'), key),
      testMALE: male(test, key),
      testMdALE: median(test.map(s => Math.abs(s.preds[key] - s.actual))),
      testBias: mean(test.map(s => s.preds[key] - s.actual)),
      testVsNaivePct: (1 - male(test, key) / naiveTest) * 100,
      testVsBasePct: (1 - male(test, key) / male(test, base)) * 100,
      testYearWinsVsBase: `${yearWinsVsBase}/${testYears.length}`,
      testDirectionHit: key === 'naive' ? null : mean(test.map(s => Number(Math.sign(s.preds[key] - s.preds.naive) === Math.sign(s.actual - s.preds.naive)))),
      frozenN: bySplit('frozen').length,
      frozenMALE: bySplit('frozen').length ? male(bySplit('frozen'), key) : null,
    };
  });
  report.horizons.push({ h, n: { train: bySplit('train').length, test: bySplit('test').length, frozen: bySplit('frozen').length }, rows: rowsOut });
}

// Pre-registered verdict for each blend.
report.verdicts = BLEND_BASES.flatMap(base => BLEND_AVGS.map(avg => {
  const key = `${base}+${avg}`;
  const wins = report.horizons.filter((hz: any) => {
    const row = hz.rows.find((r: any) => r.key === key);
    return row.testVsBasePct >= 2 && Number(row.testYearWinsVsBase.split('/')[0]) >= 3;
  }).map((hz: any) => hz.h);
  return { key, positiveHorizons: wins, verdict: wins.length >= 2 ? 'positive-signal' : 'reject' };
}));

const pct = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const num = (v: number | null) => (v == null ? 'n/a' : v.toFixed(3));
let md = `# BTC price-match study (${report.generatedAt.slice(0, 10)})\n\nReport-only. Error = |ln(forecast/actual)| (MALE, lower is better). Weekly origins. Train ${TRAIN_START}..${TEST_START}, test ${TEST_START}+, frozen ${FROZEN_START}+ (no hindsight for shipped constants).\n\n`;
md += '`shipped_hindsight` uses constants set in 2026 with all history: its train/test numbers are in-sample. Only its frozen column is out-of-sample.\n\n';
for (const hz of report.horizons) {
  md += `## ${hz.h}d (train n=${hz.n.train}, test n=${hz.n.test}, frozen n=${hz.n.frozen})\n\n| Forecast | Blend w | Train MALE | Test MALE | Test MdALE | Test bias | vs naive | vs base | Years won vs base | Direction hit | Frozen MALE |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
  for (const r of [...hz.rows].sort((a: any, b: any) => a.testMALE - b.testMALE)) {
    md += `| \`${r.key}\` | ${r.weight ?? ''} | ${num(r.trainMALE)} | ${num(r.testMALE)} | ${num(r.testMdALE)} | ${num(r.testBias)} | ${pct(r.testVsNaivePct)} | ${r.key.includes('+') ? pct(r.testVsBasePct) : ''} | ${r.key.includes('+') ? r.testYearWinsVsBase : ''} | ${r.testDirectionHit == null ? '' : `${(r.testDirectionHit * 100).toFixed(0)}%`} | ${num(r.frozenMALE)} |\n`;
  }
  md += '\n';
}
md += '## Blend verdicts (pre-registered)\n\n' + report.verdicts.map((v: any) => `- \`${v.key}\`: ${v.verdict} (horizons: ${v.positiveHorizons.join(', ') || 'none'})`).join('\n') + '\n';

mkdirSync('docs/reports/results', { recursive: true });
const stem = `docs/reports/results/btc-price-match-${report.generatedAt.slice(0, 10)}`;
writeFileSync(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(`${stem}.md`, md);
console.log(md);
