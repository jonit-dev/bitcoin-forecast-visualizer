import { describe, expect, it } from 'vitest';
import btcHistory from '../../data/btc-history.json';
import type { OHLCVData } from '../api';
import { addDays } from '../cycle';
import { RACE_START_ORIGIN, buildRaceForecasts, candidateSourceSha256, planRaceAppend, raceStatus, type RaceLedger } from '../candleMedianRace';

const ohlcv = btcHistory as OHLCVData[];
const ledger = (originDates: string[]): RaceLedger => ({
  raceVersion: 'btc-candle-median-race-v1',
  protocolSha256: 'x',
  candidateSourceSha256: 'x',
  rows: originDates.map(originDate => ({ kind: 'gap', originDate, recordedAt: '', reason: '' })),
});

describe('candle median race', () => {
  it('uses only prices up to the origin', () => {
    const origin = '2025-06-01';
    const shocked = ohlcv.map(row => (row.date > origin ? { ...row, close: row.close * 5 } : row));
    expect(buildRaceForecasts(shocked, origin)).toEqual(buildRaceForecasts(ohlcv, origin));
    expect(buildRaceForecasts(ohlcv, origin).forecasts[30].naive).toBe(ohlcv.find(row => row.date === origin)!.close);
  });

  it('starts at the race start and records a prediction while no outcome is known', () => {
    expect(planRaceAppend(ledger([]), RACE_START_ORIGIN)).toEqual([{ originDate: RACE_START_ORIGIN, kind: 'prediction' }]);
    expect(planRaceAppend(ledger([RACE_START_ORIGIN]), '2026-11-26')).toEqual([]);
    // Recorded late (close 2026-12-10) but its 14-day target is still in the future.
    expect(planRaceAppend(ledger([RACE_START_ORIGIN]), '2026-12-10')).toEqual([
      { originDate: '2026-11-27', kind: 'prediction' },
      { originDate: '2026-12-04', kind: 'prediction' },
    ]);
  });

  it('turns a missed origin into a gap once its 14-day outcome exists, and never backfills', () => {
    expect(planRaceAppend(ledger([RACE_START_ORIGIN]), '2026-12-12')).toEqual([
      { originDate: '2026-11-27', kind: 'gap' },
      { originDate: '2026-12-04', kind: 'prediction' },
      { originDate: '2026-12-11', kind: 'prediction' },
    ]);
  });

  it('shows counts only and flags review at 52 matured origins', () => {
    const origins = Array.from({ length: 52 }, (_, week) => addDays(RACE_START_ORIGIN, week * 7));
    const race = ledger(origins);
    race.rows = race.rows.map(row => ({ kind: 'prediction', originDate: row.originDate, originClose: 1, recordedAt: '', forecasts: {} }));
    const status = raceStatus(race, addDays(origins[51], 14));
    expect(status.horizons[0]).toEqual({ horizon: 14, matured: 52, readyForReview: true });
    expect(status.horizons[1].readyForReview).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/male|error|score/i);
  });

  it('freezes the candidate code with a stable hash', () => {
    expect(candidateSourceSha256()).toMatch(/^[0-9a-f]{64}$/);
    expect(candidateSourceSha256()).toBe(candidateSourceSha256());
  });
});
