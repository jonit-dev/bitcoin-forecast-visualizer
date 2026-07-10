import { seededRandom } from './random';

export interface StateSpaceParameters {
  levelProcessVariance: number;
  residualProcessVariance: number;
  observationVariance: number;
  residualPersistence: number;
}

const PARAMETER_GRID: StateSpaceParameters[] = [
  { levelProcessVariance: 1e-6, residualProcessVariance: 2.5e-5, observationVariance: 1e-5, residualPersistence: 0.85 },
  { levelProcessVariance: 4e-6, residualProcessVariance: 5e-5, observationVariance: 2.5e-5, residualPersistence: 0.9 },
  { levelProcessVariance: 1e-5, residualProcessVariance: 1e-4, observationVariance: 5e-5, residualPersistence: 0.95 },
];

export const STATE_SPACE_PARAMETER_GRID: readonly Readonly<StateSpaceParameters>[] = Object.freeze(
  PARAMETER_GRID.map(parameters => Object.freeze(parameters)),
);

export const STATE_SPACE_DEFAULT_SEED = 0x59ace202;

export interface StateSpaceObservation {
  date: string;
  residual: number | null;
}

export interface StateSpaceFit {
  parameters: Readonly<StateSpaceParameters>;
  level: number;
  meanRevertingResidual: number;
  covariance: readonly [number, number, number, number];
  innovations: readonly number[];
  standardizedInnovations: readonly number[];
  logLikelihood: number;
  observationCount: number;
  missingCount: number;
  trainingStartDate: string | null;
  trainingEndDate: string | null;
}

export interface StateSpaceForecastPoint {
  horizonDays: number;
  mean: number;
  variance: number;
}

function finitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and positive`);
}

function validateParameters(parameters: StateSpaceParameters): void {
  finitePositive(parameters.levelProcessVariance, 'levelProcessVariance');
  finitePositive(parameters.residualProcessVariance, 'residualProcessVariance');
  finitePositive(parameters.observationVariance, 'observationVariance');
  if (!Number.isFinite(parameters.residualPersistence) || parameters.residualPersistence < 0 || parameters.residualPersistence >= 1) {
    throw new Error('residualPersistence must be in [0, 1)');
  }
}

/**
 * Causal Kalman fit for y[t] = level[t] + residual[t] + observationNoise[t],
 * where level is a random walk and residual is a stationary AR(1). Missing
 * observations receive only a prediction step. Input order is authoritative.
 */
export function fitLocalLevelResidualModel(
  observations: readonly StateSpaceObservation[],
  parameters: StateSpaceParameters,
): StateSpaceFit {
  validateParameters(parameters);
  const first = observations.find(row => row.residual !== null && Number.isFinite(row.residual));
  let level = first?.residual ?? 0;
  let residual = 0;
  let p00 = 0.01;
  let p01 = 0;
  let p10 = 0;
  let p11 = parameters.residualProcessVariance / (1 - parameters.residualPersistence ** 2);
  let logLikelihood = 0;
  let missingCount = 0;
  const innovations: number[] = [];
  const standardizedInnovations: number[] = [];
  let trainingStartDate: string | null = null;
  let trainingEndDate: string | null = null;

  for (const observation of observations) {
    // Predict with F = diag(1, phi).
    residual *= parameters.residualPersistence;
    p00 += parameters.levelProcessVariance;
    p01 *= parameters.residualPersistence;
    p10 *= parameters.residualPersistence;
    p11 = parameters.residualPersistence ** 2 * p11 + parameters.residualProcessVariance;

    if (observation.residual === null || !Number.isFinite(observation.residual)) {
      missingCount++;
      continue;
    }

    const value = observation.residual;
    const innovation = value - level - residual;
    const innovationVariance = Math.max(1e-15, p00 + p01 + p10 + p11 + parameters.observationVariance);
    const k0 = (p00 + p01) / innovationVariance;
    const k1 = (p10 + p11) / innovationVariance;
    level += k0 * innovation;
    residual += k1 * innovation;

    // Joseph-equivalent scalar update; symmetrize to suppress roundoff drift.
    const old00 = p00;
    const old01 = p01;
    const old10 = p10;
    const old11 = p11;
    p00 = old00 - k0 * (old00 + old10);
    p01 = old01 - k0 * (old01 + old11);
    p10 = old10 - k1 * (old00 + old10);
    p11 = old11 - k1 * (old01 + old11);
    const cross = (p01 + p10) / 2;
    p01 = cross;
    p10 = cross;

    innovations.push(innovation);
    standardizedInnovations.push(innovation / Math.sqrt(innovationVariance));
    logLikelihood += -0.5 * (Math.log(2 * Math.PI * innovationVariance) + innovation ** 2 / innovationVariance);
    trainingStartDate ??= observation.date;
    trainingEndDate = observation.date;
  }

  return {
    parameters: Object.freeze({ ...parameters }), level, meanRevertingResidual: residual,
    covariance: Object.freeze([p00, p01, p10, p11]) as unknown as readonly [number, number, number, number],
    innovations: Object.freeze(innovations), standardizedInnovations: Object.freeze(standardizedInnovations),
    logLikelihood, observationCount: innovations.length, missingCount, trainingStartDate, trainingEndDate,
  };
}

export function selectStateSpaceParameters(
  observations: readonly StateSpaceObservation[],
  grid: readonly Readonly<StateSpaceParameters>[] = STATE_SPACE_PARAMETER_GRID,
): StateSpaceFit {
  if (grid.length === 0) throw new Error('state-space parameter grid must not be empty');
  return grid.map(parameters => fitLocalLevelResidualModel(observations, parameters))
    .reduce((best, fit) => fit.logLikelihood > best.logLikelihood ? fit : best);
}

export function forecastStateSpaceResidual(fit: StateSpaceFit, horizonDays: number): StateSpaceForecastPoint[] {
  if (!Number.isInteger(horizonDays) || horizonDays < 0) throw new Error('horizonDays must be a non-negative integer');
  const phi = fit.parameters.residualPersistence;
  let residual = fit.meanRevertingResidual;
  let [p00, p01, p10, p11] = fit.covariance;
  const result: StateSpaceForecastPoint[] = [];
  for (let day = 1; day <= horizonDays; day++) {
    residual *= phi;
    p00 += fit.parameters.levelProcessVariance;
    p01 *= phi;
    p10 *= phi;
    p11 = phi ** 2 * p11 + fit.parameters.residualProcessVariance;
    result.push({ horizonDays: day, mean: fit.level + residual, variance: Math.max(0, p00 + p01 + p10 + p11) });
  }
  return result;
}

export type InnovationGeneratorMethod = 'moving-block' | 'volatility-regime' | 'state-space';

export interface InnovationGenerationInput {
  innovations: readonly number[];
  horizonDays: number;
  simulations?: number;
  blockLength?: number;
  seed?: number;
  method: InnovationGeneratorMethod;
  stateSpaceFit?: StateSpaceFit;
  regimeWindow?: number;
}

export interface GeneratedInnovations {
  paths: number[][];
  metadata: {
    method: InnovationGeneratorMethod;
    seed: number;
    blockLength: number;
    sourceObservationCount: number;
    trainingEndDate: string | null;
  };
}

function standardNormal(rng: () => number): number {
  const u1 = Math.max(Number.EPSILON, rng());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
}

/** Samples contiguous, origin-available innovation blocks; never shuffles days independently. */
export function generateOriginSafeInnovations(input: InnovationGenerationInput): GeneratedInnovations {
  const source = input.innovations.filter(Number.isFinite);
  const horizonDays = Math.max(0, Math.floor(input.horizonDays));
  const simulations = Math.max(1, Math.floor(input.simulations ?? 1));
  const blockLength = Math.max(1, Math.min(Math.floor(input.blockLength ?? 7), Math.max(1, source.length)));
  const seed = (input.seed ?? STATE_SPACE_DEFAULT_SEED) >>> 0;
  const rng = seededRandom(seed);
  if (input.method !== 'state-space' && source.length === 0) throw new Error('block generators require finite historical innovations');

  const paths: number[][] = [];
  for (let simulation = 0; simulation < simulations; simulation++) {
    const path: number[] = [];
    if (input.method === 'state-space') {
      if (!input.stateSpaceFit) throw new Error('state-space method requires stateSpaceFit');
      const sigma = Math.sqrt(input.stateSpaceFit.parameters.residualProcessVariance + input.stateSpaceFit.parameters.levelProcessVariance);
      for (let day = 0; day < horizonDays; day++) path.push(standardNormal(rng) * sigma);
    } else {
      while (path.length < horizonDays) {
        let candidates = Array.from({ length: Math.max(1, source.length - blockLength + 1) }, (_, index) => index);
        if (input.method === 'volatility-regime' && source.length > blockLength) {
          const window = Math.max(2, Math.floor(input.regimeWindow ?? 14));
          const recent = source.slice(-window);
          const targetVol = rootMeanSquare(recent);
          const scored = candidates.map(start => ({ start, distance: Math.abs(rootMeanSquare(source.slice(start, start + blockLength)) - targetVol) }));
          scored.sort((a, b) => a.distance - b.distance || a.start - b.start);
          candidates = scored.slice(0, Math.max(1, Math.ceil(scored.length / 3))).map(row => row.start);
        }
        const start = candidates[Math.floor(rng() * candidates.length)];
        for (let offset = 0; offset < blockLength && path.length < horizonDays; offset++) path.push(source[start + offset]);
      }
    }
    paths.push(path);
  }
  return { paths, metadata: { method: input.method, seed, blockLength, sourceObservationCount: source.length, trainingEndDate: input.stateSpaceFit?.trainingEndDate ?? null } };
}

export function generateStateSpaceInnovations(input: Omit<InnovationGenerationInput, 'method'>): GeneratedInnovations {
  return generateOriginSafeInnovations({ ...input, method: 'state-space' });
}

function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function rootMeanSquare(values: readonly number[]): number { return values.length ? Math.sqrt(mean(values.map(value => value ** 2))) : 0; }
function autocorrelation(values: readonly number[], absolute = false): number {
  if (values.length < 3) return 0;
  const transformed = absolute ? values.map(Math.abs) : [...values];
  const avg = mean(transformed);
  let numerator = 0; let denominator = 0;
  for (let i = 0; i < transformed.length; i++) {
    denominator += (transformed[i] - avg) ** 2;
    if (i > 0) numerator += (transformed[i] - avg) * (transformed[i - 1] - avg);
  }
  return denominator > 0 ? numerator / denominator : 0;
}

export interface PathDiagnostics {
  mean: number;
  variance: number;
  lag1Autocorrelation: number;
  absoluteLag1Autocorrelation: number;
  signChangeRate: number;
  q05: number;
  q50: number;
  q95: number;
  maximumDrawdown: number;
  maximumDrawdownDuration: number;
}

export function computePathDiagnostics(values: readonly number[]): PathDiagnostics {
  const finite = values.filter(Number.isFinite);
  const avg = mean(finite);
  const sorted = [...finite].sort((a, b) => a - b);
  const quantile = (p: number) => sorted.length ? sorted[Math.round((sorted.length - 1) * p)] : 0;
  let changes = 0; let cumulative = 0; let peak = 0; let drawdown = 0; let duration = 0; let maxDuration = 0;
  for (let i = 0; i < finite.length; i++) {
    if (i > 0 && finite[i] * finite[i - 1] < 0) changes++;
    cumulative += finite[i];
    if (cumulative >= peak) { peak = cumulative; duration = 0; } else { duration++; maxDuration = Math.max(maxDuration, duration); }
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return {
    mean: avg, variance: mean(finite.map(value => (value - avg) ** 2)),
    lag1Autocorrelation: autocorrelation(finite), absoluteLag1Autocorrelation: autocorrelation(finite, true),
    signChangeRate: finite.length > 1 ? changes / (finite.length - 1) : 0,
    q05: quantile(0.05), q50: quantile(0.5), q95: quantile(0.95),
    maximumDrawdown: drawdown, maximumDrawdownDuration: maxDuration,
  };
}
