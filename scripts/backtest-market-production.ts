/**
 * Walk-forward gate for the S&P 500 (VOO) and gold (GLD) forecasts exactly as
 * production serves them: `buildGenericModelInputs` + `computeGenericProbabilityForecast`
 * on the history up to each origin, calendar-day horizons, target = last close on
 * or before origin + horizon. Two incumbents share the production median:
 * `legacy` drops the session volatility term structure, and `price-only` (S&P 500)
 * drops only the VIX first year. Each comparison isolates one change.
 *
 *   npm run backtest:market-production [-- --json out.json]
 *
 * Metrics are in log-price space relative to the origin close: MAE of the median,
 * mean pinball loss over q05/q10/q50/q90/q95 (a CRPS proxy), 80%/90% coverage and
 * the Brier score of probabilityUp. Paired differences use a Newey-West t statistic
 * whose lag spans the overlapping horizon. Term-structure parameters were fit on
 * data before HOLDOUT_START; the gate reads the holdout only.
 */
import { writeFileSync } from 'node:fs';
import { loadMarketData, type OHLCVData } from '../src/lib/api';
import {
  SP500_VOL_TERM_STRUCTURE,
  buildGenericModelInputs,
  buildVolTermStructure,
  computeGenericProbabilityForecast,
} from '../src/lib/marketForecast';
import type { ProbabilityForecast } from '../src/lib/data';

const ASSETS = ['sp500', 'gold'] as const;
const HORIZONS = [7, 14, 30, 90, 180, 365] as const;
const HOLDOUT_START = '2019-01-01';
const STEP = 5;
const MIN_ORIGIN_INDEX = 1000;
const QUANTILES = [0.05, 0.1, 0.5, 0.9, 0.95] as const;

interface Outcome {
  origin: string;
  ae: number;
  pinball: number;
  in80: boolean;
  in90: boolean;
  brier: number;
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function score(forecast: ProbabilityForecast, spot: number, y: number, origin: string): Outcome {
  const q = [forecast.q05, forecast.q10, forecast.median, forecast.q90, forecast.q95].map((price) => Math.log(price / spot));
  const pinball = QUANTILES.reduce((sum, p, index) => {
    const diff = y - q[index];
    return sum + Math.max(p * diff, (p - 1) * diff);
  }, 0) / QUANTILES.length;
  return {
    origin,
    ae: Math.abs(y - q[2]),
    pinball,
    in80: y >= q[1] && y <= q[3],
    in90: y >= q[0] && y <= q[4],
    brier: (forecast.probabilityUp - (y > 0 ? 1 : 0)) ** 2,
  };
}

interface Arms { legacy: Outcome; priceOnly: Outcome; production: Outcome }

/** Scored outcomes of every arm for each matured origin. */
function evaluate(assetId: (typeof ASSETS)[number], rows: OHLCVData[], horizon: number): Arms[] {
  const arms: Arms[] = [];
  // Full series: the model reads only the VIX dated on the session before the origin.
  const impliedVol = loadMarketData(assetId).impliedVol;
  const lastDate = rows[rows.length - 1].date;
  let target = MIN_ORIGIN_INDEX;
  for (let index = MIN_ORIGIN_INDEX; index < rows.length; index += STEP) {
    const origin = rows[index].date;
    const targetDate = addDays(origin, horizon);
    if (targetDate > lastDate) break;
    target = Math.max(target, index);
    while (target + 1 < rows.length && rows[target + 1].date <= targetDate) target++;
    if (target <= index) continue;

    const history = rows.slice(0, index + 1);
    const { modelInputs, calibrationLabel } = buildGenericModelInputs(assetId, history, horizon, impliedVol);
    const forecast = (logVarianceByDay: number[] | undefined) =>
      computeGenericProbabilityForecast(history, horizon, { ...modelInputs, logVarianceByDay }, calibrationLabel);
    const production = forecast(modelInputs.logVarianceByDay);
    const legacy = forecast(undefined);
    const priceOnly = impliedVol
      ? forecast(buildVolTermStructure(history, modelInputs.returns, horizon, SP500_VOL_TERM_STRUCTURE) ?? undefined)
      : production;
    if (!production || !legacy || !priceOnly) continue;
    const spot = rows[index].close;
    const y = Math.log(rows[target].close / spot);
    arms.push({
      legacy: score(legacy, spot, y, origin),
      priceOnly: score(priceOnly, spot, y, origin),
      production: score(production, spot, y, origin),
    });
  }
  return arms;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

/** Newey-West t statistic of the mean of a serially correlated series. */
function neweyWestT(values: number[], lag: number): number {
  const n = values.length;
  if (n < 3) return 0;
  const avg = mean(values);
  const centered = values.map((value) => value - avg);
  let longRunVariance = centered.reduce((sum, value) => sum + value * value, 0) / n;
  for (let k = 1; k <= Math.min(lag, n - 1); k++) {
    let cov = 0;
    for (let t = k; t < n; t++) cov += centered[t] * centered[t - k];
    longRunVariance += 2 * (1 - k / (lag + 1)) * (cov / n);
  }
  return longRunVariance > 0 ? avg / Math.sqrt(longRunVariance / n) : 0;
}

function summarize(outcomes: Outcome[]) {
  return {
    n: outcomes.length,
    mae: mean(outcomes.map((o) => o.ae)),
    pinball: mean(outcomes.map((o) => o.pinball)),
    cov80: mean(outcomes.map((o) => (o.in80 ? 1 : 0))),
    cov90: mean(outcomes.map((o) => (o.in90 ? 1 : 0))),
    brier: mean(outcomes.map((o) => o.brier)),
  };
}

function compare(horizon: number, period: 'train' | 'holdout', pairs: [Outcome, Outcome][]) {
  const incumbent = summarize(pairs.map(([o]) => o));
  const production = summarize(pairs.map(([, o]) => o));
  const lag = Math.ceil((horizon * 252) / 365 / STEP) + 1;
  return {
    horizon,
    period,
    incumbent,
    production,
    pinballGainPct: (1 - production.pinball / incumbent.pinball) * 100,
    pinballT: neweyWestT(pairs.map(([a, b]) => a.pinball - b.pinball), lag),
  };
}

type Comparison = ReturnType<typeof compare>;

function format(label: string, c: Comparison): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  return [
    `[${label}]`.padEnd(22),
    `h=${String(c.horizon).padStart(3)}`,
    c.period.padEnd(7),
    `n=${String(c.incumbent.n).padStart(3)}`,
    `pinball ${c.incumbent.pinball.toFixed(5)}->${c.production.pinball.toFixed(5)} (${c.pinballGainPct >= 0 ? '+' : ''}${c.pinballGainPct.toFixed(1)}% t=${c.pinballT.toFixed(2)})`,
    `cov90 ${pct(c.incumbent.cov90)}->${pct(c.production.cov90)}`,
    `cov80 ${pct(c.incumbent.cov80)}->${pct(c.production.cov80)}`,
    `brier ${c.incumbent.brier.toFixed(3)}->${c.production.brier.toFixed(3)}`,
  ].join('  ');
}

/**
 * Holdout gate per asset: no horizon loses pinball score, the mean gain is at
 * least 1%, and every 90% band is within 85-95% coverage or no farther from 90%
 * than the incumbent's.
 */
function gate(comparisons: Comparison[]): string[] {
  const holdout = comparisons.filter((c) => c.period === 'holdout');
  const failures: string[] = [];
  for (const c of holdout) {
    if (c.pinballGainPct < 0) failures.push(`h=${c.horizon} pinball regressed ${c.pinballGainPct.toFixed(2)}%`);
    const miss = Math.abs(c.production.cov90 - 0.9);
    if (miss > 0.05 && miss > Math.abs(c.incumbent.cov90 - 0.9) + 1e-9) {
      failures.push(`h=${c.horizon} cov90 ${(c.production.cov90 * 100).toFixed(1)}% outside 85-95%`);
    }
  }
  const meanGain = mean(holdout.map((c) => c.pinballGainPct));
  if (meanGain < 1) failures.push(`mean holdout pinball gain ${meanGain.toFixed(2)}% < 1%`);
  return failures;
}

function main(): void {
  const report: Record<string, Comparison[]> = {};
  let failed = false;
  const gates = [
    { assetId: 'sp500', baseline: 'legacy' },
    { assetId: 'sp500', baseline: 'priceOnly' },
    { assetId: 'gold', baseline: 'legacy' },
  ] as const;
  for (const assetId of ASSETS) {
    const rows = loadMarketData(assetId).ohlcv;
    const byHorizon = HORIZONS.map((horizon) => ({ horizon, arms: evaluate(assetId, rows, horizon) }));
    for (const { baseline } of gates.filter((entry) => entry.assetId === assetId)) {
      const label = `${assetId} vs ${baseline}`;
      const comparisons: Comparison[] = [];
      for (const { horizon, arms } of byHorizon) {
        for (const period of ['train', 'holdout'] as const) {
          const subset = arms
            .filter((arm) => (period === 'holdout') === (arm.production.origin >= HOLDOUT_START))
            .map((arm) => [arm[baseline], arm.production] as [Outcome, Outcome]);
          const c = compare(horizon, period, subset);
          comparisons.push(c);
          console.log(format(label, c));
        }
      }
      const failures = gate(comparisons);
      console.log(`[${label}] ${failures.length === 0 ? 'PASS' : `FAIL: ${failures.join('; ')}`}`);
      failed ||= failures.length > 0;
      report[label] = comparisons;
    }
  }
  const jsonIndex = process.argv.indexOf('--json');
  if (jsonIndex > 0) writeFileSync(process.argv[jsonIndex + 1], `${JSON.stringify(report, null, 2)}\n`);
  if (failed) process.exitCode = 1;
}

main();
