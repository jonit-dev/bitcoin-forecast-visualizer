import { describe, expect, it } from 'vitest';
import {
  STATE_SPACE_PARAMETER_GRID,
  computePathDiagnostics,
  fitLocalLevelResidualModel,
  forecastStateSpaceResidual,
  generateOriginSafeInnovations,
  selectStateSpaceParameters,
  type StateSpaceObservation,
} from '../stateSpaceResidual';

const parameters = STATE_SPACE_PARAMETER_GRID[1];

function observations(count = 160): StateSpaceObservation[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2025-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
    residual: 0.012 * Math.sin(index / 6) + 0.004 * Math.sin(index / 2),
  }));
}

describe('local-level state-space residual model', () => {
  it('should update state using observations available through origin only', () => {
    const history = observations();
    const origin = 100;
    const before = fitLocalLevelResidualModel(history.slice(0, origin), parameters);
    const mutatedFuture = history.map((row, index) => index < origin ? row : { ...row, residual: 1000 + index });
    const after = fitLocalLevelResidualModel(mutatedFuture.slice(0, origin), parameters);

    expect(after).toEqual(before);
    expect(before.trainingEndDate).toBe(history[origin - 1].date);
    expect(before.observationCount).toBe(origin);
  });

  it('handles missing observations with prediction-only updates and finite forecasts', () => {
    const history = observations(80);
    history[20].residual = null;
    history[21].residual = Number.NaN;
    const fit = fitLocalLevelResidualModel(history, parameters);
    const forecast = forecastStateSpaceResidual(fit, 90);

    expect(fit.missingCount).toBe(2);
    expect(fit.observationCount).toBe(78);
    expect(forecast).toHaveLength(90);
    expect(forecast.every(point => Number.isFinite(point.mean) && point.variance >= 0)).toBe(true);
    expect(Math.abs(forecast.at(-1)!.mean - fit.level)).toBeLessThan(Math.abs(forecast[0].mean - fit.level));
  });

  it('selects deterministically from the frozen parameter grid', () => {
    expect(Object.isFrozen(STATE_SPACE_PARAMETER_GRID)).toBe(true);
    expect(STATE_SPACE_PARAMETER_GRID.every(Object.isFrozen)).toBe(true);
    expect(selectStateSpaceParameters(observations())).toEqual(selectStateSpaceParameters(observations()));
  });
});

describe('origin-safe state-space innovation generation', () => {
  it('is deterministic for a seed and records auditable generator metadata', () => {
    const source = observations().map(row => row.residual!);
    const input = { innovations: source, horizonDays: 60, simulations: 4, blockLength: 8, seed: 1234, method: 'moving-block' as const };
    const first = generateOriginSafeInnovations(input);
    const second = generateOriginSafeInnovations(input);
    const different = generateOriginSafeInnovations({ ...input, seed: 1235 });

    expect(first).toEqual(second);
    expect(first.paths).not.toEqual(different.paths);
    expect(first.metadata).toEqual({ method: 'moving-block', seed: 1234, blockLength: 8, sourceObservationCount: 160, trainingEndDate: null });
  });

  it('should preserve block dependence in generated innovations', () => {
    const source = Array.from({ length: 240 }, (_, index) => {
      const cluster = Math.floor(index / 20) % 2 === 0 ? 0.003 : 0.025;
      return cluster * Math.sin(index / 3);
    });
    const generated = generateOriginSafeInnovations({
      innovations: source, horizonDays: 240, simulations: 12, blockLength: 12, seed: 9876, method: 'moving-block',
    });
    const sourceDiagnostics = computePathDiagnostics(source);
    const generatedDiagnostics = generated.paths.map(computePathDiagnostics);
    const meanAbsoluteAc = generatedDiagnostics.reduce((sum, row) => sum + row.absoluteLag1Autocorrelation, 0) / generatedDiagnostics.length;
    const meanAc = generatedDiagnostics.reduce((sum, row) => sum + row.lag1Autocorrelation, 0) / generatedDiagnostics.length;

    expect(meanAc).toBeGreaterThan(0.5);
    expect(meanAbsoluteAc).toBeGreaterThan(0.5);
    expect(Math.abs(meanAc - sourceDiagnostics.lag1Autocorrelation)).toBeLessThan(0.2);
  });

  it('conditions regime blocks on volatility known at the origin', () => {
    const low = Array.from({ length: 120 }, (_, i) => Math.sin(i) * 0.002);
    const high = Array.from({ length: 40 }, (_, i) => Math.sin(i) * 0.04);
    const source = [...low, ...high];
    const regime = generateOriginSafeInnovations({ innovations: source, horizonDays: 80, blockLength: 8, seed: 7, method: 'volatility-regime' });
    const ordinary = generateOriginSafeInnovations({ innovations: source, horizonDays: 80, blockLength: 8, seed: 7, method: 'moving-block' });

    expect(computePathDiagnostics(regime.paths[0]).variance).toBeGreaterThan(computePathDiagnostics(ordinary.paths[0]).variance);
  });
});
