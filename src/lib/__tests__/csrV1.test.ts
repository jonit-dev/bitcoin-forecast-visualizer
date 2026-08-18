import { describe, expect, it } from 'vitest';
import vooHistory from '../../data/voo-history.json';
import {
  CSR_V1_HORIZONS,
  CSR_V1_SHORT_WEIGHTS,
  buildCsrAnchors,
  buildCsrFeatureRecord,
  buildCsrProjection,
  computeCsrEndpoint,
  csrSessionCounts,
  predictCsrResidual,
  type CsrOriginInputs,
} from '../csrV1';
import { buildMarketForecast, computeSP500ModelInputs } from '../marketForecast';

const ohlcv = vooHistory as { date: string; open: number; high: number; low: number; close: number; volume: number }[];
const last = ohlcv[ohlcv.length - 1];
const baseline = computeSP500ModelInputs(ohlcv);
const origin: CsrOriginInputs = {
  spot: last.close,
  mu: baseline.drift,
  sigma: baseline.dailyVol,
  expandingEquityPremium: baseline.expandingEquityPremium,
};

describe('CSR v1 residual inference', () => {
  it('reproduces the offline sklearn predictions for the frozen 2026-08-14 origin', () => {
    // Golden values dumped from the sandbox pipeline that trained the artifact.
    // Any drift here means the TS port and the fitted trees have diverged.
    const sessions = csrSessionCounts(last.date);
    const expected: Record<number, number> = {
      7: -0.0009603869028335539,
      90: -0.021341945003613805,
      365: -0.09261712071294037,
    };
    for (const [horizon, value] of Object.entries(expected)) {
      const days = Number(horizon) as 7 | 90 | 365;
      const features = buildCsrFeatureRecord(ohlcv, origin, days, sessions[days]);
      expect(predictCsrResidual(days, features)).toBeCloseTo(value, 12);
    }
  });

  it('counts market sessions from the exchange calendar, not 252/365', () => {
    const sessions = csrSessionCounts('2026-08-14');
    expect(sessions[7]).toBe(5);
    expect(sessions[14]).toBe(10); // Aug 17-28, no holiday
    expect(sessions[30]).toBe(19); // Labor Day closes Sep 7
    expect(sessions[365]).toBe(250);
    // A naive 252/365 approximation would put the 10-year anchor days away.
    expect(sessions[3650]).not.toBe(Math.round((3650 * 252) / 365));
  });

  it('leaves the 180-day anchor equal to the incumbent point and width', () => {
    expect(CSR_V1_SHORT_WEIGHTS[180]).toBe(0);
    const sessions = csrSessionCounts(last.date);
    const anchors = buildCsrAnchors(origin, sessions, { 7: 0, 14: 0, 30: 0, 90: 0, 365: 0 });
    const anchor = anchors?.find((candidate) => candidate.horizonDays === 180);
    expect(anchor?.medianLogReturn).toBeCloseTo(origin.mu * 180, 15);
    expect(anchor?.logVariance).toBeCloseTo(origin.sigma * origin.sigma * 180, 15);
  });

  it('fails closed when a weighted horizon has no residual prediction', () => {
    const sessions = csrSessionCounts(last.date);
    expect(buildCsrAnchors(origin, sessions, { 7: 0.01 })).toBeNull();
  });

  it('rejects snapshots shorter than the trained minimum', () => {
    expect(buildCsrProjection(ohlcv.slice(-500), origin, 365)).toBeNull();
  });
});

describe('CSR v1 forecast surface', () => {
  const marketData = { ohlcv } as Parameters<typeof buildMarketForecast>[1];

  it('keeps the median path prefix-stable when the horizon is extended', () => {
    const pathFor = (horizon: number) =>
      buildMarketForecast('sp500', marketData, horizon, 1.6448536269514722)
        .displayData.filter((row: { isForecast: boolean }) => row.isForecast);

    const short = pathFor(90);
    const long = pathFor(3650);
    for (let index = 0; index < short.length; index += 1) {
      expect(long[index].date).toBe(short[index].date);
      expect(long[index].forecast).toBe(short[index].forecast);
      expect(long[index].forecastLower).toBe(short[index].forecastLower);
      expect(long[index].forecastUpper).toBe(short[index].forecastUpper);
    }
  }, 30_000);

  it('holds the median flat across non-session calendar days', () => {
    const rows = buildMarketForecast('sp500', marketData, 30, 1.6448536269514722)
      .displayData.filter((row: { isForecast: boolean }) => row.isForecast);
    const weekend = rows.filter((row: { date: string }) => {
      const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
      return weekday === 0 || weekday === 6;
    });
    expect(weekend.length).toBeGreaterThan(0);
    for (const row of weekend) {
      const previous = rows[rows.indexOf(row) - 1] ?? { forecast: last.close };
      expect(row.forecast).toBeCloseTo(previous.forecast, 12);
    }
  });

  it('reports the session-residual interval at every UI horizon', () => {
    for (const horizon of CSR_V1_HORIZONS) {
      const forecast = buildMarketForecast('sp500', marketData, horizon, 1.6448536269514722).probabilityForecast;
      expect(forecast?.calibrationLabel).toBe('Session-residual interval');
      expect(forecast!.q05).toBeLessThan(forecast!.median);
      expect(forecast!.median).toBeLessThan(forecast!.q95);
    }
    // Nine full renders over a 4,000-session snapshot; the channel pass alone
    // costs ~1.4s per horizon, independent of this model.
  }, 60_000);

  it('matches the endpoint anchor to the last row of the rendered path', () => {
    const sessions = csrSessionCounts(last.date);
    const projection = buildCsrProjection(ohlcv, origin, 365)!;
    const endpoint = computeCsrEndpoint(origin, projection.anchors, 365, 1.6448536269514722)!;
    expect(endpoint.sessions).toBe(sessions[365]);

    const rows = buildMarketForecast('sp500', marketData, 365, 1.6448536269514722)
      .displayData.filter((row: { isForecast: boolean }) => row.isForecast);
    expect(rows[rows.length - 1].forecast).toBeCloseTo(endpoint.medianPrice, 6);
  });

  it('leaves the gold surface on its own model', () => {
    const gold = buildMarketForecast('gold', { ohlcv } as Parameters<typeof buildMarketForecast>[1], 30, 1.6448536269514722);
    expect(gold.probabilityForecast?.calibrationLabel).not.toBe('Session-residual interval');
  });
});
