import { describe, expect, it } from 'vitest';
import { mergeRepairCandles } from '../../../scripts/update-btc-data.mjs';

const candle = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1 });
const cached = [
  candle('2026-09-05', 100),
  candle('2026-09-06', 101),
  candle('2026-09-07', 102),
  candle('2026-09-08', 103),
];

describe('BTC repair merge', () => {
  it('should preserve cached candles a sparse but successful repair omits', () => {
    const { rows, uncovered } = mergeRepairCandles(cached, [candle('2026-09-08', 104)], '2026-09-05', '2026-09-08');

    expect(rows.map((row) => row.date)).toEqual(['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']);
    expect(rows.at(-1)!.close).toBe(104);
    expect(uncovered).toEqual([]);
  });

  it('should report a date neither the cache nor the response can supply', () => {
    const { uncovered } = mergeRepairCandles(cached, [candle('2026-09-08', 104)], '2026-09-04', '2026-09-08');

    expect(uncovered).toEqual(['2026-09-04']);
  });

  it('should leave history before the repair window untouched', () => {
    const { rows } = mergeRepairCandles(cached, [candle('2026-09-08', 104)], '2026-09-07', '2026-09-08');

    expect(rows.map((row) => row.date)).toEqual(['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']);
    expect(rows[0].close).toBe(100);
  });
});
