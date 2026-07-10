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
});
