import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { getPhaseState, type PhaseLabel } from '../src/lib/cycle';
import { basePowerLawPrice, daysSinceGenesis, powerLawForecast } from '../src/lib/powerLaw';

interface Sample {
  date: string;
  close: number;
  modelPrice: number;
  residual: number;
  phase: PhaseLabel;
  progress: number;
}

interface Regression {
  intercept: number;
  slope: number;
  count: number;
  r2: number;
}

const HORIZONS = [14, 30, 60, 90] as const;
const TRAIN_END = '2021-12-31';
const TEST_START = '2022-01-01';

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    sign *
    (1 -
      (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
        Math.exp(-absX * absX));
  return 0.5 * (1 + erf);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[], avg = mean(values)): number {
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, values.length - 1);
}

function welchPValue(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = variance(a, meanA);
  const varB = variance(b, meanB);
  const denom = Math.sqrt(varA / a.length + varB / b.length);
  if (!Number.isFinite(denom) || denom === 0) return null;
  const z = Math.abs((meanA - meanB) / denom);
  return 2 * (1 - normalCdf(z));
}

function contiguousDays(data: Sample[], start: number, horizon: number): boolean {
  for (let step = 0; step < horizon; step++) {
    const current = new Date(data[start + step].date + 'T00:00:00Z');
    const next = new Date(data[start + step + 1].date + 'T00:00:00Z');
    if ((next.getTime() - current.getTime()) / 86400000 !== 1) return false;
  }
  return true;
}

function annotateHistory(data: OHLCVData[]): Sample[] {
  return data.flatMap((row) => {
    const phase = getPhaseState(row.date);
    if (!phase) return [];

    const date = new Date(row.date + 'T00:00:00Z');
    const modelPrice = basePowerLawPrice(daysSinceGenesis(date));

    return [{
      date: row.date,
      close: row.close,
      modelPrice,
      residual: Math.log(row.close / modelPrice),
      phase: phase.label,
      progress: phase.progress,
    }];
  });
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function fitRegression(x: number[], y: number[]): Regression {
  const xMean = mean(x);
  const yMean = mean(y);
  let sxx = 0;
  let sxy = 0;
  let sst = 0;

  for (let i = 0; i < x.length; i++) {
    sxx += (x[i] - xMean) ** 2;
    sxy += (x[i] - xMean) * (y[i] - yMean);
    sst += (y[i] - yMean) ** 2;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = yMean - slope * xMean;
  let sse = 0;

  for (let i = 0; i < x.length; i++) {
    const predicted = intercept + slope * x[i];
    sse += (y[i] - predicted) ** 2;
  }

  return {
    intercept,
    slope,
    count: x.length,
    r2: sst === 0 ? 0 : 1 - sse / sst,
  };
}

function currentState(samples: Sample[]): Sample {
  return samples[samples.length - 1];
}

function printCurrentState(sample: Sample): void {
  console.log('Current state');
  console.log(
    [
      `date=${sample.date}`,
      `phase=${sample.phase}`,
      `phaseProgress=${sample.progress.toFixed(3)}`,
      `price=${sample.close.toFixed(0)}`,
      `model=${sample.modelPrice.toFixed(0)}`,
      `price/model=${(sample.close / sample.modelPrice).toFixed(3)}`,
      `logResidual=${sample.residual.toFixed(4)}`,
    ].join('  ')
  );
  console.log('');
}

function printForwardStats(samples: Sample[]): void {
  console.log('Forward returns by phase and price/model sign');

  for (const horizon of HORIZONS) {
    console.log(`\nHorizon ${horizon}d`);

    for (const phase of ['Accumulation', 'Bull', 'Trim', 'Bear'] as const) {
      const below: number[] = [];
      const above: number[] = [];
      const farBelow: number[] = [];

      for (let i = 0; i + horizon < samples.length; i++) {
        const current = samples[i];
        if (current.phase !== phase || !contiguousDays(samples, i, horizon)) continue;

        const future = samples[i + horizon];
        const forwardLogReturn = Math.log(future.close / current.close);

        if (current.residual < 0) below.push(forwardLogReturn);
        else above.push(forwardLogReturn);
        if (current.residual <= -0.2) farBelow.push(forwardLogReturn);
      }

      const pValue = welchPValue(below, above);
      const meanBelow = below.length ? mean(below) : NaN;
      const meanAbove = above.length ? mean(above) : NaN;
      const meanFarBelow = farBelow.length ? mean(farBelow) : NaN;

      console.log(
        [
          phase.padEnd(12),
          `below n=${String(below.length).padStart(4)} ${formatPct(meanBelow)}`,
          `above n=${String(above.length).padStart(4)} ${formatPct(meanAbove)}`,
          `diff=${formatPct(meanBelow - meanAbove)}`,
          `farBelow=${Number.isFinite(meanFarBelow) ? formatPct(meanFarBelow) : 'n/a'}`,
          `p≈${pValue == null ? 'n/a' : pValue.toExponential(2)}`,
        ].join('  ')
      );
    }
  }

  console.log('');
}

function printNearestAnalogs(samples: Sample[]): void {
  const current = currentState(samples);
  const candidates = samples
    .map((sample, index) => ({ sample, index }))
    .filter(({ sample, index }) =>
      sample.phase === current.phase &&
      sample.date < TEST_START &&
      index + 90 < samples.length &&
      contiguousDays(samples, index, 90)
    )
    .map(({ sample, index }) => ({
      sample,
      index,
      distance:
        ((sample.progress - current.progress) / 0.12) ** 2 +
        ((sample.residual - current.residual) / 0.12) ** 2,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  console.log('Nearest historical analogs to the current state');

  for (const { sample, index } of candidates) {
    const returns = HORIZONS.map((horizon) => {
      const future = samples[index + horizon];
      return `${horizon}d=${formatPct(Math.log(future.close / sample.close))}`;
    });

    console.log(
      [
        sample.date,
        `progress=${sample.progress.toFixed(3)}`,
        `logResidual=${sample.residual.toFixed(4)}`,
        ...returns,
      ].join('  ')
    );
  }

  console.log('');
}

function fitPhaseResidualRegressions(samples: Sample[]): Map<number, Map<PhaseLabel, Regression>> {
  const fitted = new Map<number, Map<PhaseLabel, Regression>>();

  for (const horizon of HORIZONS) {
    const byPhase = new Map<PhaseLabel, Regression>();

    for (const phase of ['Accumulation', 'Bull', 'Trim', 'Bear'] as const) {
      const x: number[] = [];
      const y: number[] = [];

      for (let i = 0; i + horizon < samples.length; i++) {
        const current = samples[i];
        if (current.phase !== phase || current.date > TRAIN_END || !contiguousDays(samples, i, horizon)) continue;

        x.push(current.residual);
        y.push(samples[i + horizon].residual);
      }

      if (x.length >= 20) byPhase.set(phase, fitRegression(x, y));
    }

    fitted.set(horizon, byPhase);
  }

  return fitted;
}

function printRegressions(regressions: Map<number, Map<PhaseLabel, Regression>>): void {
  console.log('Future residual regression by phase');

  for (const horizon of HORIZONS) {
    console.log(`\nHorizon ${horizon}d`);
    const byPhase = regressions.get(horizon)!;

    for (const phase of ['Accumulation', 'Bull', 'Trim', 'Bear'] as const) {
      const regression = byPhase.get(phase);
      if (!regression) continue;
      console.log(
        [
          phase.padEnd(12),
          `n=${String(regression.count).padStart(4)}`,
          `futureResidual=${regression.intercept.toFixed(4)} + ${regression.slope.toFixed(4)}*residual`,
          `R2=${regression.r2.toFixed(3)}`,
        ].join('  ')
      );
    }
  }

  console.log('');
}

function backtest(samples: Sample[], regressions: Map<number, Map<PhaseLabel, Regression>>): void {
  console.log('Holdout endpoint backtest vs current power-law path');

  for (const horizon of HORIZONS) {
    const byPhase = regressions.get(horizon)!;
    const baselineErrors: number[] = [];
    const stateErrors: number[] = [];

    for (let i = 0; i + horizon < samples.length; i++) {
      const current = samples[i];
      const regression = byPhase.get(current.phase);
      if (!regression || current.date < TEST_START || !contiguousDays(samples, i, horizon)) continue;

      const target = samples[i + horizon];
      const targetDate = new Date(target.date + 'T00:00:00Z');
      const currentDate = new Date(current.date + 'T00:00:00Z');
      const baseline = powerLawForecast(targetDate, current.close, currentDate);
      const stateResidual = regression.intercept + regression.slope * current.residual;
      const stateForecast = target.modelPrice * Math.exp(stateResidual);

      baselineErrors.push(Math.abs(Math.log(baseline / target.close)));
      stateErrors.push(Math.abs(Math.log(stateForecast / target.close)));
    }

    const baselineMae = mean(baselineErrors);
    const stateMae = mean(stateErrors);
    const delta = stateMae - baselineMae;

    console.log(
      [
        `${String(horizon).padStart(3)}d`,
        `baselineMAE=${baselineMae.toFixed(4)}`,
        `stateMAE=${stateMae.toFixed(4)}`,
        `delta=${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`,
      ].join('  ')
    );
  }

  console.log('');
}

function main(): void {
  const samples = annotateHistory(btcHistory as OHLCVData[]);
  printCurrentState(currentState(samples));
  printForwardStats(samples);
  printNearestAnalogs(samples);

  const regressions = fitPhaseResidualRegressions(samples);
  printRegressions(regressions);
  backtest(samples, regressions);
}

main();
