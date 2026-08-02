import { describe, expect, it } from 'vitest';
import { countCrossingEpisodes, exponentialMovingAverage, holmAdjust, hysteresisCrosses, nextOpenForwardLogReturn, simpleMovingAverage, strictCrosses } from '../trendReversal';

describe('trend reversal research helpers', () => {
  it('calculates trailing SMAs without future values', () => {
    expect(simpleMovingAverage([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it('uses the frozen recursive EMA convention', () => {
    expect(exponentialMovingAverage([10, 13, 13], 2)).toEqual([10, 12, 12 + 2 / 3]);
  });

  it('emits only sign-changing crosses', () => {
    expect(strictCrosses([1, 2, 1, 3], [2, 2, 2, 2])).toEqual([0, 0, -1, 1]);
  });

  it('requires a full opposite-band transition for hysteresis signals', () => {
    expect(hysteresisCrosses([98, 100, 102, 100, 98], [100, 100, 100, 100, 100], 0.01)).toEqual([0, 0, 1, 0, -1]);
  });

  it('applies monotone Holm adjustment in original order', () => {
    expect(holmAdjust([0.04, 0.01, 0.03])).toEqual([0.06, 0.03, 0.06]);
  });

  it('measures only next-open forward returns with a mature in-period target', () => {
    const rows = [
      { date: '2024-01-01', open: 10 },
      { date: '2024-01-02', open: 12 },
      { date: '2024-01-03', open: 15 },
      { date: '2024-01-04', open: 18 },
    ];
    expect(nextOpenForwardLogReturn(rows, 0, 2, '2024-01-04')).toBeCloseTo(Math.log(18 / 12));
    expect(nextOpenForwardLogReturn(rows, 0, 2, '2024-01-03')).toBeNull();
    expect(nextOpenForwardLogReturn(rows, 1, 2)).toBeNull();
  });

  it('treats transitive whipsaws as one episode until a full cooldown gap', () => {
    expect(countCrossingEpisodes(['2024-01-01', '2024-01-10', '2024-01-20', '2024-02-05'], 14)).toBe(2);
  });
});
