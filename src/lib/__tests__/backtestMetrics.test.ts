import { describe, expect, it } from 'vitest';
import { pinballLosses } from '../backtestMetrics';

describe('backtest metrics', () => {
  it('should compute pinball loss for multiple quantiles', () => {
    const losses = pinballLosses(10, {
      0.1: 8,
      0.5: 11,
      0.9: 12,
    });

    expect(losses[0.1]).toBeCloseTo(0.2);
    expect(losses[0.5]).toBeCloseTo(0.5);
    expect(losses[0.9]).toBeCloseTo(0.2);
  });
});
