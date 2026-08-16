import snapshot from '../../data/sp500-crisis-model.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentCrisisRisk, sp500CrisisModel } from '../sp500CrisisModel';

afterEach(() => {
  vi.doUnmock('../../data/sp500-crisis-model.json');
  vi.resetModules();
});

describe('S&P 500 crisis challenger snapshot', () => {
  it('should expose the imported current score when the snapshot is valid', () => {
    const current = sp500CrisisModel.currentScore;

    expect(sp500CrisisModel.source.archive).toBe('sp500-crisis-model-v2.zip');
    expect(sp500CrisisModel.source.snapshotDate).toBe('2026-08-15');
    expect(current.asOfDate).toBe('2026-08-14');
    expect(current.baseRawProbability).toBeCloseTo(0.3496369834, 10);
    expect(current.incumbentProbability).toBeCloseTo(0.0483463555, 10);
    expect(current.challengerDeploymentProbability).toBeCloseTo(0.0351327435, 10);
    expect(current.deploymentThresholds.watch).toBeCloseTo(0.1068545811, 10);
    expect(current.deploymentThresholds.high).toBeCloseTo(0.2393876216, 10);
    expect(current.riskZone).toBe('NORMAL');
  });

  it('should reject a snapshot with an invalid probability', async () => {
    const invalidSnapshot = JSON.parse(JSON.stringify(snapshot)) as Record<string, any>;
    invalidSnapshot.currentScore.challengerDeploymentProbability = 1.01;
    vi.resetModules();
    vi.doMock('../../data/sp500-crisis-model.json', () => ({ default: invalidSnapshot }));

    await expect(import('../sp500CrisisModel')).rejects.toThrow('challengerDeploymentProbability');
  });

  it('should mark a score stale only when the quote is newer', () => {
    expect(getCurrentCrisisRisk('2026-08-13').isStale).toBe(false);
    expect(getCurrentCrisisRisk('2026-08-14').isStale).toBe(false);
    expect(getCurrentCrisisRisk('2026-08-15').isStale).toBe(true);
  });

  it('should preserve the OOS history, holdout uncertainty, and context-only verdict', () => {
    expect(sp500CrisisModel.oosHistory).toHaveLength(1025);
    expect(sp500CrisisModel.oosHistory[0]).toMatchObject({ date: '2000-01-07', target: 0 });
    expect(sp500CrisisModel.oosHistory.at(-1)).toMatchObject({ date: '2025-12-26', target: 0 });
    expect(sp500CrisisModel.holdout.period).toBe('2016-2025');
    expect(sp500CrisisModel.holdout.uncertainty.brier_improvement.ci_95[0]).toBeLessThan(0);
    expect(sp500CrisisModel.holdout.uncertainty.brier_improvement.ci_95[1]).toBeGreaterThan(0);
    expect(sp500CrisisModel.runtime.mode).toBe('shadow');
    expect(sp500CrisisModel.runtime.verdict).toBe('context-only');
    expect(sp500CrisisModel.runtime.promotionStatus).toBe('not-promoted');
  });
});
