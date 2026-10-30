import { describe, expect, it } from 'vitest';
import { countUsMarketSessionsAfter, isUsMarketSessionDay } from '../../../shared/us-market-calendar.mjs';

describe('US market session calendar', () => {
  it('excludes weekends and observed exchange holidays', () => {
    expect(isUsMarketSessionDay('2026-07-03')).toBe(false); // Independence Day observed
    expect(isUsMarketSessionDay('2026-07-04')).toBe(false);
    expect(isUsMarketSessionDay('2026-04-03')).toBe(false); // Good Friday
    expect(isUsMarketSessionDay('2026-07-06')).toBe(true);
  });

  it('does not count a Monday market holiday as a stale session', () => {
    expect(countUsMarketSessionsAfter('2026-01-16', '2026-01-22')).toBe(3); // MLK Day on Jan 19
  });

  it('counts the same sessions for a date string, midnight and an intraday Date on the same UTC day', () => {
    expect(countUsMarketSessionsAfter('2026-08-17', '2026-08-20')).toBe(3);
    expect(countUsMarketSessionsAfter('2026-08-17', new Date('2026-08-20T00:00:00Z'))).toBe(3);
    // 23:15 UTC is when the refresh worker runs; that day's session has elapsed.
    expect(countUsMarketSessionsAfter('2026-08-17', new Date('2026-08-20T23:15:00Z'))).toBe(3);
    expect(countUsMarketSessionsAfter('2026-08-13', new Date('2026-08-14T23:15:00Z'))).toBe(1);
    expect(countUsMarketSessionsAfter('2026-08-13', new Date('2026-08-16T23:15:00Z'))).toBe(1);
  });
});
