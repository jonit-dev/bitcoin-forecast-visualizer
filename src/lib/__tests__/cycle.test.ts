import { describe, expect, it } from 'vitest';
import { cycleAmplitudeDampingForFuturePivot } from '../cycle';

describe('cycle strategy helpers', () => {
  it('should decay future cycle amplitude when configured', () => {
    const firstProjectedPivot = cycleAmplitudeDampingForFuturePivot({
      date: '2025-10-08',
      type: 'ATH',
      known: false,
    });
    const laterProjectedPivot = cycleAmplitudeDampingForFuturePivot({
      date: '2028-09-05',
      type: 'ATH',
      known: false,
    });

    expect(firstProjectedPivot).toBeGreaterThan(0);
    expect(laterProjectedPivot).toBeGreaterThan(0);
    expect(laterProjectedPivot).toBeLessThan(firstProjectedPivot);
  });
});
