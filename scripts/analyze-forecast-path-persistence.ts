import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { processRealData, type ForecastPathPolicy } from '../src/lib/data';
import type { OHLCVData } from '../src/lib/api';

// Frozen gates: docs/reports/experiments-backlog.md, "Date-keyed yellow forecast path".
const POLICIES: ForecastPathPolicy[] = ['production-baseline', 'date-keyed-v1'];
const HORIZONS = [30, 90];
const FIRST_ORIGIN = '2022-01-01';
const ORIGIN_STEP_DAYS = 7;

const rows: OHLCVData[] = JSON.parse(readFileSync('src/data/btc-history.json', 'utf8'));
const closeByDate = new Map(rows.map((row) => [row.date, row.close]));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function forecastTraces(originIndex: number, horizon: number, policy: ForecastPathPolicy) {
  const display = processRealData(rows.slice(0, originIndex + 1), horizon, 1.96, policy);
  return display.filter((row) => row.isForecast && row.stochasticTraces) as Array<{ date: string; stochasticTraces: number[] }>;
}

function pathStats(prices: number[]) {
  const returns = prices.slice(1).map((price, index) => Math.log(price / prices[index]));
  const m = mean(returns);
  const vol = Math.sqrt(mean(returns.map((r) => (r - m) ** 2)));
  const abs = returns.map(Math.abs);
  const am = mean(abs);
  const denominator = abs.reduce((sum, value) => sum + (value - am) ** 2, 0);
  const acf1 = denominator > 0 ? abs.slice(1).reduce((sum, value, index) => sum + (value - am) * (abs[index] - am), 0) / denominator : 0;
  let peak = prices[0];
  let maxDrawdown = 0;
  for (const price of prices) {
    peak = Math.max(peak, price);
    maxDrawdown = Math.max(maxDrawdown, 1 - price / peak);
  }
  return { vol, acf1, maxDrawdown };
}

function evaluate(policy: ForecastPathPolicy, horizon: number) {
  const firstIndex = rows.findIndex((row) => row.date >= FIRST_ORIGIN);
  const dayChanges: number[] = [];
  let covered = 0;
  const crps: number[] = [];
  const vols: number[] = [];
  const acfs: number[] = [];
  const drawdowns: number[] = [];
  let origins = 0;
  for (let index = firstIndex; index + horizon < rows.length - 1; index += ORIGIN_STEP_DAYS) {
    const today = forecastTraces(index, horizon, policy);
    const tomorrow = new Map(forecastTraces(index + 1, horizon, policy).map((row) => [row.date, row.stochasticTraces[0]]));
    const changes = today.filter((row) => tomorrow.has(row.date)).map((row) => Math.abs(Math.log(tomorrow.get(row.date)! / row.stochasticTraces[0])));
    dayChanges.push(mean(changes));

    const terminal = today.at(-1)!;
    const realized = closeByDate.get(terminal.date);
    if (!realized) continue;
    origins++;
    const ensemble = terminal.stochasticTraces;
    if (realized >= Math.min(...ensemble) && realized <= Math.max(...ensemble)) covered++;
    const spread = mean(ensemble.flatMap((a) => ensemble.map((b) => Math.abs(a - b))));
    crps.push((mean(ensemble.map((value) => Math.abs(value - realized))) - 0.5 * spread) / realized);

    for (let trace = 0; trace < ensemble.length; trace++) {
      const stats = pathStats([rows[index].close, ...today.map((row) => row.stochasticTraces[trace])]);
      vols.push(stats.vol);
      acfs.push(stats.acf1);
      drawdowns.push(stats.maxDrawdown);
    }
  }
  return {
    policy, horizon, origins,
    meanDayOverDayChange: mean(dayChanges),
    rangeCoverage: covered / origins,
    meanRelativeCrps: mean(crps),
    medianDailyVol: median(vols),
    medianAbsReturnAcf1: median(acfs),
    medianMaxDrawdown: median(drawdowns),
  };
}

const results = HORIZONS.flatMap((horizon) => POLICIES.map((policy) => evaluate(policy, horizon)));
const gates = HORIZONS.map((horizon) => {
  const [base, cand] = POLICIES.map((policy) => results.find((r) => r.policy === policy && r.horizon === horizon)!);
  const within10 = (a: number, b: number) => Math.abs(b - a) <= 0.1 * Math.abs(a);
  const checks = {
    persistenceCutAtLeast50pct: cand.meanDayOverDayChange <= 0.5 * base.meanDayOverDayChange,
    coverageWithin2pp: Math.abs(cand.rangeCoverage - base.rangeCoverage) <= 0.02,
    crpsNotWorseThan2pct: cand.meanRelativeCrps <= base.meanRelativeCrps * 1.02,
    volWithin10pct: within10(base.medianDailyVol, cand.medianDailyVol),
    absAcfWithin10pct: within10(base.medianAbsReturnAcf1, cand.medianAbsReturnAcf1),
    drawdownWithin10pct: within10(base.medianMaxDrawdown, cand.medianMaxDrawdown),
  };
  return { horizon, checks, pass: Object.values(checks).every(Boolean) };
});
const verdict = gates.every((gate) => gate.pass) ? 'pass' : 'fail';
const commit = process.env.GIT_COMMIT ?? execSync('git rev-parse --short HEAD').toString().trim();
const report = { generatedAt: new Date().toISOString(), gitCommit: commit, firstOrigin: FIRST_ORIGIN, originStepDays: ORIGIN_STEP_DAYS, verdict, gates, results };

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const markdown = [
  '# Forecast path persistence: production-baseline vs date-keyed-v1 (BTC)',
  '',
  `Generated ${report.generatedAt} at \`${commit}\`. Origins every ${ORIGIN_STEP_DAYS} days from ${FIRST_ORIGIN}. Verdict: **${verdict}**.`,
  '',
  '| Horizon | Policy | Origins | Day-over-day change | Range coverage | Relative CRPS | Daily vol | |r| ACF(1) | Max drawdown |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.horizon}d | ${r.policy} | ${r.origins} | ${pct(r.meanDayOverDayChange)} | ${pct(r.rangeCoverage)} | ${pct(r.meanRelativeCrps)} | ${pct(r.medianDailyVol)} | ${r.medianAbsReturnAcf1.toFixed(3)} | ${pct(r.medianMaxDrawdown)} |`),
  '',
  '| Horizon | Gate | Pass |',
  '| --- | --- | --- |',
  ...gates.flatMap((gate) => Object.entries(gate.checks).map(([name, pass]) => `| ${gate.horizon}d | ${name} | ${pass ? 'yes' : 'no'} |`)),
  '',
].join('\n');

const out = process.argv[2] ?? 'docs/reports/results/forecast-path-persistence-2026-10-26';
writeFileSync(`${out}.json`, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(`${out}.md`, markdown);
console.log(markdown);
