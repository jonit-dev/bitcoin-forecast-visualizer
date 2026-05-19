import btcHistory from '../src/data/btc-history.json';
import mvrvHistory from '../src/data/mvrv-history.json';
import type { OHLCVData, MVRVPoint } from '../src/lib/api';
import { getPhaseState, type PhaseLabel } from '../src/lib/cycle';
import { basePowerLawPrice, daysSinceGenesis, POWER_LAW_MEAN_REVERSION_TAU_DAYS, powerLawForecast } from '../src/lib/powerLaw';

type Horizon = 14 | 30 | 60 | 90 | 180 | 365;

interface Row {
  date: string;
  close: number;
  modelPrice: number;
  residual: number;
  phase: PhaseLabel | null;
  progress: number;
  logMvrv: number;
  mvrvZ: number;
  mom30: number;
  mom90: number;
  vol30: number;
}

interface DataPoint {
  x: number[];
  y: number;
  current: Row;
  target: Row;
}

const HORIZONS: Horizon[] = [14, 30, 60, 90, 180, 365];
const TRAIN_END = '2021-12-31';
const TEST_START = '2022-01-01';

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function contiguousDays(rows: Row[], start: number, horizon: number): boolean {
  for (let step = 0; step < horizon; step++) {
    const current = new Date(rows[start + step].date + 'T00:00:00Z');
    const next = new Date(rows[start + step + 1].date + 'T00:00:00Z');
    if ((next.getTime() - current.getTime()) / 86400000 !== 1) return false;
  }
  return true;
}

function buildRows(): Row[] {
  const mvrvByDate = new Map((mvrvHistory as MVRVPoint[]).map((row) => [row.date, row]));
  const ohlcv = btcHistory as OHLCVData[];
  const rows: Row[] = [];
  const diffs: number[] = [];

  for (let i = 0; i < ohlcv.length; i++) {
    const row = ohlcv[i];
    const date = new Date(row.date + 'T00:00:00Z');
    const modelPrice = basePowerLawPrice(daysSinceGenesis(date));
    const phase = getPhaseState(row.date);
    const mvrv = mvrvByDate.get(row.date);
    const diff = mvrv && mvrv.mvrv > 0 ? mvrv.marketCap - mvrv.marketCap / mvrv.mvrv : null;

    let mvrvZ = 0;
    if (diff != null && diffs.length >= 365) {
      const avg = mean(diffs);
      const variance = mean(diffs.map((value) => (value - avg) ** 2));
      mvrvZ = variance > 0 ? (diff - avg) / Math.sqrt(variance) : 0;
    }
    if (diff != null) diffs.push(diff);

    const mom30 = i >= 30 ? Math.log(row.close / ohlcv[i - 30].close) : 0;
    const mom90 = i >= 90 ? Math.log(row.close / ohlcv[i - 90].close) : 0;
    const returns30 = i >= 30
      ? ohlcv.slice(i - 29, i + 1).map((point, index, slice) => index === 0 ? 0 : Math.log(point.close / slice[index - 1].close)).slice(1)
      : [];
    const vol30 = returns30.length ? Math.sqrt(mean(returns30.map((value) => (value - mean(returns30)) ** 2))) : 0;

    rows.push({
      date: row.date,
      close: row.close,
      modelPrice,
      residual: Math.log(row.close / modelPrice),
      phase: phase?.label ?? null,
      progress: phase?.progress ?? 0,
      logMvrv: mvrv && mvrv.mvrv > 0 ? Math.log(mvrv.mvrv) : 0,
      mvrvZ,
      mom30,
      mom90,
      vol30,
    });
  }

  return rows;
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];

    const pivotValue = a[col][col] || 1e-12;
    for (let j = col; j <= n; j++) a[col][j] /= pivotValue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row[n]);
}

function fitRidge(train: DataPoint[], lambda: number): { weights: number[]; center: number[]; scale: number[] } {
  const width = train[0].x.length;
  const center = Array.from({ length: width }, (_, j) => mean(train.map((point) => point.x[j])));
  const scale = Array.from({ length: width }, (_, j) => {
    const variance = mean(train.map((point) => (point.x[j] - center[j]) ** 2));
    return variance > 0 ? Math.sqrt(variance) : 1;
  });

  const xtx = Array.from({ length: width + 1 }, () => Array(width + 1).fill(0));
  const xty = Array(width + 1).fill(0);

  for (const point of train) {
    const x = [1, ...point.x.map((value, j) => (value - center[j]) / scale[j])];
    for (let i = 0; i < x.length; i++) {
      xty[i] += x[i] * point.y;
      for (let j = 0; j < x.length; j++) xtx[i][j] += x[i] * x[j];
    }
  }

  for (let i = 1; i < xtx.length; i++) xtx[i][i] += lambda;
  return { weights: solveLinearSystem(xtx, xty), center, scale };
}

function predict(model: ReturnType<typeof fitRidge>, xRaw: number[]): number {
  const x = [1, ...xRaw.map((value, j) => (value - model.center[j]) / model.scale[j])];
  return x.reduce((sum, value, index) => sum + value * model.weights[index], 0);
}

function phaseFeatures(row: Row): number[] {
  return [
    row.phase === 'Accumulation' ? 1 : 0,
    row.phase === 'Bull' ? 1 : 0,
    row.phase === 'Trim' ? 1 : 0,
    row.phase === 'Bear' ? 1 : 0,
    row.progress,
  ];
}

const FEATURE_SETS = [
  {
    name: 'residual',
    build: (row: Row) => [row.residual],
  },
  {
    name: 'residual+phase',
    build: (row: Row) => [row.residual, ...phaseFeatures(row), ...phaseFeatures(row).map((value) => value * row.residual)],
  },
  {
    name: 'residual+phase+mvrv+momentum',
    build: (row: Row) => [
      row.residual,
      ...phaseFeatures(row),
      ...phaseFeatures(row).map((value) => value * row.residual),
      row.logMvrv,
      row.mvrvZ,
      row.mom30,
      row.mom90,
      row.vol30,
    ],
  },
] as const;

function buildDataPoints(rows: Row[], horizon: Horizon, buildFeatures: (row: Row) => number[]): DataPoint[] {
  const points: DataPoint[] = [];
  for (let i = 365; i + horizon < rows.length; i++) {
    if (!contiguousDays(rows, i, horizon)) continue;
    const current = rows[i];
    const target = rows[i + horizon];
    points.push({
      x: buildFeatures(current),
      y: target.residual,
      current,
      target,
    });
  }
  return points;
}

function endpointMae(points: DataPoint[], model?: ReturnType<typeof fitRidge>): number {
  const errors = points.map((point) => {
    const forecast = model
      ? point.target.modelPrice * Math.exp(predict(model, point.x))
      : powerLawForecast(
        new Date(point.target.date + 'T00:00:00Z'),
        point.current.close,
        new Date(point.current.date + 'T00:00:00Z')
      );
    return Math.abs(Math.log(forecast / point.target.close));
  });
  return mean(errors);
}

function tauForecast(current: Row, target: Row, tau: number): number {
  const hDays = Math.round(
    (new Date(target.date + 'T00:00:00Z').getTime() - new Date(current.date + 'T00:00:00Z').getTime()) / 86400000
  );
  return target.modelPrice * Math.exp(current.residual * Math.exp(-hDays / tau));
}

function printTauSweep(rows: Row[]): void {
  const taus = [30, 60, 90, 120, 150, 180, 210, 270, 365, 540, 730, 1095];
  console.log('\nTau sweep for current power-law residual mean reversion');
  console.log('Lower MAE is better. Train chooses tau from dates <= 2021-12-31, then reports 2022+ holdout.');

  for (const horizon of HORIZONS) {
    const points = buildDataPoints(rows, horizon, (row) => [row.residual]);
    const train = points.filter((point) => point.current.date <= TRAIN_END);
    const test = points.filter((point) => point.current.date >= TEST_START);
    const scored = taus.map((tau) => ({
      tau,
      trainMae: mean(train.map((point) => Math.abs(Math.log(tauForecast(point.current, point.target, tau) / point.target.close)))),
      testMae: mean(test.map((point) => Math.abs(Math.log(tauForecast(point.current, point.target, tau) / point.target.close)))),
    }));
    const trainBest = scored.reduce((best, row) => row.trainMae < best.trainMae ? row : best);
    const current = scored.find((row) => row.tau === POWER_LAW_MEAN_REVERSION_TAU_DAYS)!;
    console.log(
      `${String(horizon).padStart(3)}d  trainBestTau=${String(trainBest.tau).padStart(4)} trainMAE=${trainBest.trainMae.toFixed(4)} holdoutMAE=${trainBest.testMae.toFixed(4)}  currentTau=${POWER_LAW_MEAN_REVERSION_TAU_DAYS} holdoutMAE=${current.testMae.toFixed(4)}`
    );
  }
}

function printFeatureBacktests(rows: Row[]): void {
  const lambdas = [0, 0.1, 1, 10, 100];
  console.log('\nEndpoint residual models');
  console.log('Models train on dates <= 2021-12-31 and are tested on 2022+ holdout.');

  for (const horizon of HORIZONS) {
    console.log(`\nHorizon ${horizon}d`);

    for (const featureSet of FEATURE_SETS) {
      const points = buildDataPoints(rows, horizon, featureSet.build);
      const train = points.filter((point) => point.current.date <= TRAIN_END);
      const test = points.filter((point) => point.current.date >= TEST_START);
      const baseline = endpointMae(test);
      const best = lambdas
        .map((lambda) => {
          const model = fitRidge(train, lambda);
          return {
            lambda,
            trainMae: endpointMae(train, model),
            testMae: endpointMae(test, model),
          };
        })
        .reduce((winner, candidate) => candidate.trainMae < winner.trainMae ? candidate : winner);

      console.log(
        [
          featureSet.name.padEnd(28),
          `baseline=${baseline.toFixed(4)}`,
          `model=${best.testMae.toFixed(4)}`,
          `delta=${(best.testMae - baseline >= 0 ? '+' : '')}${(best.testMae - baseline).toFixed(4)}`,
          `lambda=${best.lambda}`,
        ].join('  ')
      );
    }
  }
}

function computeLogReturnVol(rows: Row[], endIndex: number, lookback: number): number {
  const start = Math.max(1, endIndex - lookback + 1);
  const returns: number[] = [];
  for (let i = start; i <= endIndex; i++) {
    returns.push(Math.log(rows[i].close / rows[i - 1].close));
  }
  const avg = mean(returns);
  return Math.sqrt(mean(returns.map((value) => (value - avg) ** 2)));
}

function sumPowers(base: number, count: number, square = false): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += Math.pow(base, square ? 2 * i : i);
  return sum;
}

function normalNll(value: number, meanValue: number, variance: number): number {
  return 0.5 * Math.log(2 * Math.PI * variance) + ((value - meanValue) ** 2) / (2 * variance);
}

function printHeatmapGrid(rows: Row[]): void {
  const taus = [60, 120, 210, 365, 540];
  const recentWeights = [0, 0.25, 0.55, 0.75, 1];
  const driftScales = [-0.3, 0, 0.3, 0.6];
  const indexByDate = new Map(rows.map((row, index) => [row.date, index]));

  console.log('\nProbabilistic residual process grid');
  console.log('Grid is selected by pre-2022 avg NLL, then evaluated on 2022+ holdout. Current app params are tau=210, volWeight=0.55, driftScale=0.3.');

  for (const horizon of HORIZONS) {
    const points = buildDataPoints(rows, horizon, (row) => [row.residual]);
    const train = points.filter((point) => point.current.date <= TRAIN_END);
    const test = points.filter((point) => point.current.date >= TEST_START);

    const score = (pointSet: DataPoint[], tau: number, recentWeight: number, driftScale: number) => {
      const decay = Math.exp(-1 / tau);
      const decayMean = sumPowers(decay, horizon);
      const decayVariance = sumPowers(decay, horizon, true);

      const nlls = pointSet.map((point) => {
        const currentIndex = indexByDate.get(point.current.date)!;
        const recentVol = computeLogReturnVol(rows, currentIndex, 90);
        const structuralVol = computeLogReturnVol(rows, currentIndex, 365);
        const sigma = Math.sqrt(recentWeight * recentVol * recentVol + (1 - recentWeight) * structuralVol * structuralVol);
        const predictedMean = point.current.residual * Math.exp(-horizon / tau) - driftScale * sigma * sigma * decayMean;
        const variance = Math.max(1e-12, sigma * sigma * decayVariance);
        return normalNll(point.target.residual, predictedMean, variance);
      });

      return mean(nlls);
    };

    let best = { tau: 0, recentWeight: 0, driftScale: 0, trainNll: Infinity, testNll: Infinity };
    for (const tau of taus) {
      for (const recentWeight of recentWeights) {
        for (const driftScale of driftScales) {
          const trainNll = score(train, tau, recentWeight, driftScale);
          if (trainNll < best.trainNll) {
            best = {
              tau,
              recentWeight,
              driftScale,
              trainNll,
              testNll: score(test, tau, recentWeight, driftScale),
            };
          }
        }
      }
    }

    const currentNll = score(test, POWER_LAW_MEAN_REVERSION_TAU_DAYS, 0.55, 0.3);
    console.log(
      `${String(horizon).padStart(3)}d  trainBest=tau${best.tau}/w${best.recentWeight}/d${best.driftScale} trainNLL=${best.trainNll.toFixed(4)} holdoutNLL=${best.testNll.toFixed(4)}  currentHoldoutNLL=${currentNll.toFixed(4)} delta=${(best.testNll - currentNll >= 0 ? '+' : '')}${(best.testNll - currentNll).toFixed(4)}`
    );
  }
}

const rows = buildRows();
console.log(`Forecast study exploration  rows=${rows.length}  first=${rows[0].date}  last=${rows[rows.length - 1].date}`);
printTauSweep(rows);
printFeatureBacktests(rows);
printHeatmapGrid(rows);
