import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import btcHistory from '../src/data/btc-history.json';
import { aggregateForecastMetrics, type ForecastDistribution } from '../src/lib/backtestMetrics';
import { getBacktestModels } from '../src/lib/backtestModels';
import { computeProbabilityForecast } from '../src/lib/data';
import { seededRandom } from '../src/lib/random';
import { holmAdjust } from '../src/lib/trendReversal';

const DAY_MS = 86_400_000;
const HORIZONS = [14, 30, 60, 90];
const REPLICATES = 5_000;
const SEED = 20261117;
const FIT_START = '2017-01-01';
const FIT_END = '2021-12-31';
const EVALUATION_START = '2022-01-01';
const OLD_DATA_END = '2026-11-05';
const models = getBacktestModels();
const incumbent = models.find(model => model.id === 'powerlaw-current')!;
const driftless = models.find(model => model.id === 'gbm-driftless')!;
const latest = btcHistory.at(-1)!;

for (const [index, row] of btcHistory.entries()) {
  assert(Number.isFinite(row.close) && row.close > 0, `Invalid BTC close on ${row.date}`);
  if (index > 0) {
    assert.equal(Date.parse(row.date) - Date.parse(btcHistory[index - 1].date), DAY_MS, `BTC gap at ${row.date}`);
  }
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function shifted(forecast: ForecastDistribution, offset: number): ForecastDistribution {
  const factor = Math.exp(offset);
  return {
    ...forecast,
    median: forecast.median * factor,
    quantiles: Object.fromEntries(Object.entries(forecast.quantiles!).map(([key, price]) => [key, price * factor])),
  };
}

function bootstrap(differences: number[], horizon: number) {
  const observed = mean(differences);
  const blockLength = Math.ceil(horizon / 7);
  const random = seededRandom(SEED + horizon);
  const estimates = Array.from({ length: REPLICATES }, () => {
    let sum = 0;
    for (let i = 0; i < differences.length; i += blockLength) {
      const start = Math.floor(random() * differences.length);
      for (let j = 0; j < Math.min(blockLength, differences.length - i); j++) {
        sum += differences[(start + j) % differences.length];
      }
    }
    return sum / differences.length;
  }).sort((a, b) => a - b);
  return {
    blockLength,
    interval95: [estimates[Math.floor(REPLICATES * .025)], estimates[Math.floor(REPLICATES * .975) - 1]],
    p: (1 + estimates.filter(value => value - observed >= observed).length) / (REPLICATES + 1),
  };
}

const results = HORIZONS.map(horizon => {
  const runtime = computeProbabilityForecast(btcHistory, horizon)!;
  const endpoint = incumbent.forecast(btcHistory, btcHistory.length - 1, horizon)!;
  assert.equal(endpoint.median, runtime.median, `Runtime and replay medians differ at ${horizon}d`);
  for (const key of ['q05', 'q10', 'q90', 'q95'] as const) {
    assert(Math.abs(Math.log(endpoint.quantiles![key]! / runtime[key])) < 1e-8, `Runtime and replay ${key} differ`);
  }

  const fitErrors: number[] = [];
  const rows = [];
  for (const [index, origin] of btcHistory.entries()) {
    const target = btcHistory[index + horizon];
    if (!target || origin.date < FIT_START || (Date.parse(origin.date) - Date.parse(FIT_START)) % (7 * DAY_MS) !== 0) continue;
    const forecast = incumbent.forecast(btcHistory, index, horizon)!;
    if (target.date <= FIT_END) {
      fitErrors.push(Math.log(target.close / forecast.median));
    } else if (origin.date >= EVALUATION_START) {
      rows.push({ origin, target, forecast, naive: driftless.forecast(btcHistory, index, horizon)! });
    }
  }
  assert(fitErrors.length > 30 && rows.length > 30);
  fitErrors.sort((a, b) => a - b);
  const offset = (fitErrors[Math.floor((fitErrors.length - 1) / 2)] + fitErrors[Math.floor(fitErrors.length / 2)]) / 2;
  const evaluated = rows.map(row => {
    const actual = row.target.close;
    const candidate = shifted(row.forecast, offset);
    const improvement = Math.abs(Math.log(actual / row.forecast.median)) - Math.abs(Math.log(actual / candidate.median));
    return { ...row, actual, candidate, improvement };
  });
  const scores = (key: 'forecast' | 'candidate' | 'naive') => aggregateForecastMetrics(evaluated.map(row => ({
    actual: row.actual,
    forecast: row[key],
  })));
  const subgroup = (subset: typeof evaluated) => ({
    samples: subset.length,
    pairedImprovement: subset.length ? mean(subset.map(row => row.improvement)) : null,
  });
  const incumbentScores = scores('forecast');
  const candidateScores = scores('candidate');
  return {
    horizon,
    offset,
    fitOrigins: fitErrors.length,
    firstOrigin: evaluated[0].origin.date,
    lastOrigin: evaluated.at(-1)!.origin.date,
    lastTarget: evaluated.at(-1)!.target.date,
    incumbent: incumbentScores,
    candidate: candidateScores,
    driftless: scores('naive'),
    relativeMaleImprovement: 1 - candidateScores.meanAbsLogError! / incumbentScores.meanAbsLogError!,
    relativeCrpsChange: candidateScores.crps! / incumbentScores.crps! - 1,
    ...bootstrap(evaluated.map(row => row.improvement), horizon),
    early: subgroup(evaluated.filter(row => row.origin.date < '2025-01-01')),
    recent: subgroup(evaluated.filter(row => row.origin.date >= '2025-01-01')),
    addedTargets: subgroup(evaluated.filter(row => row.target.date > OLD_DATA_END)),
  };
});
const adjustedP = holmAdjust(results.map(result => result.p));
console.log(JSON.stringify({
  data: { first: btcHistory[0].date, last: latest.date, rows: btcHistory.length, sha256: createHash('sha256').update(JSON.stringify(btcHistory)).digest('hex') },
  seed: SEED,
  replicates: REPLICATES,
  fit: [FIT_START, FIT_END],
  evaluationStart: EVALUATION_START,
  results: results.map((result, index) => ({ ...result, holmP: adjustedP[index] })),
}, null, 2));
