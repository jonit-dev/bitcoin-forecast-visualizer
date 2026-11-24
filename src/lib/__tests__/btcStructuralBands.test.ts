import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OHLCVData } from '../api';
import {
  addUtcDaysStr,
  circularBlockBootstrapMeanDiff,
  empiricalQuantile,
  evaluateStretchedLogOls,
  fitQuantileLine,
  fitStretchedLogOls,
  fitStructuralBandArm,
  holmAdjust,
  neweyWestDmT,
  pinballLossLog,
  trailingDailyLogVol,
  utcDaysSinceGenesis,
  winklerScoreLog,
  winklerScoreOhlcLog,
  type StructuralBandArmId,
} from '../btcStructuralBands';

function makeSyntheticBtcHistory(): OHLCVData[] {
  const start = '2011-01-01';
  const totalDays = 5600; // covers ~2011 to mid-2026
  const rows: OHLCVData[] = [];
  for (let i = 0; i < totalDays; i++) {
    const date = addUtcDaysStr(start, i);
    const t = utcDaysSinceGenesis(date);
    const baseLog = -12 + 2.6 * Math.pow(Math.log(t), 0.72);
    const wave = 0.55 * Math.sin((2 * Math.PI * i) / 1460) + 0.12 * Math.sin(i / 29);
    const close = Math.exp(baseLog + wave);
    rows.push({
      date,
      open: close * 0.99,
      high: close * 1.03,
      low: close * 0.97,
      close,
      volume: 1e8,
    });
  }
  return rows;
}

describe('btcStructuralBands invariants and math helpers', () => {
  it('recovers synthetic quantile lines accurately via fitQuantileLine', () => {
    const xs: number[] = [];
    const ys: number[] = [];
    // Symmetric residuals at each distinct x so population & sample quantile lines are exact
    for (let block = 0; block < 24; block++) {
      const x = 1 + (block / 23) * 9;
      for (let j = 0; j < 25; j++) {
        const err = (j - 12) * 0.05; // symmetric in [-0.60, +0.60] around 0
        xs.push(x);
        ys.push(1.25 + 2.75 * x + err);
      }
    }

    const fit50 = fitQuantileLine(xs, ys, 0.5);
    expect(fit50.slope).toBeCloseTo(2.75, 3);
    expect(fit50.intercept).toBeCloseTo(1.25, 2);

    const fit10 = fitQuantileLine(xs, ys, 0.1);
    const fit90 = fitQuantileLine(xs, ys, 0.9);
    expect(fit10.slope).toBeCloseTo(2.75, 3);
    expect(fit90.slope).toBeCloseTo(2.75, 3);
    expect(fit10.intercept).toBeLessThan(fit50.intercept);
    expect(fit90.intercept).toBeGreaterThan(fit50.intercept);
  });

  it('matches standard OLS to < 1e-12 when gamma = 1 in fitStretchedLogOls', () => {
    const logTs = [6.5, 7.0, 7.5, 8.0, 8.5, 8.8];
    const logYs = [1.2, 4.1, 6.8, 9.7, 10.2, 11.4];
    const fit = fitStretchedLogOls(logTs, logYs, 1.0);

    const mx = logTs.reduce((a, b) => a + b, 0) / logTs.length;
    const my = logYs.reduce((a, b) => a + b, 0) / logYs.length;
    const num = logTs.reduce((s, x, i) => s + (x - mx) * (logYs[i] - my), 0);
    const den = logTs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const olsSlope = num / den;
    const olsIntercept = my - olsSlope * mx;

    expect(Math.abs(fit.slope - olsSlope)).toBeLessThan(1e-12);
    expect(Math.abs(fit.intercept - olsIntercept)).toBeLessThan(1e-12);
    expect(Math.abs(evaluateStretchedLogOls(fit, Math.exp(8.0)) - (olsIntercept + olsSlope * 8.0))).toBeLessThan(1e-12);
  });

  it('computes exact winklerScoreLog, winklerScoreOhlcLog, and pinballLossLog', () => {
    const lower = 100;
    const upper = Math.exp(Math.log(100) + 1.0); // width = 1.0
    const alpha = 0.05; // penalty factor = 40

    // Inside band
    expect(winklerScoreLog(lower, upper, 150, alpha)).toBeCloseTo(1.0, 12);

    // Below lower by 0.2 in log space -> 1.0 + 40 * 0.2 = 9.0
    const actualLow = lower * Math.exp(-0.2);
    expect(winklerScoreLog(lower, upper, actualLow, alpha)).toBeCloseTo(9.0, 11);

    // Above upper by 0.1 in log space -> 1.0 + 40 * 0.1 = 5.0
    const actualHigh = upper * Math.exp(0.1);
    expect(winklerScoreLog(lower, upper, actualHigh, alpha)).toBeCloseTo(5.0, 11);

    // OHLC extremes penalize both low < lower and high > upper
    expect(winklerScoreOhlcLog(lower, upper, actualLow, actualHigh, alpha)).toBeCloseTo(1.0 + 8.0 + 4.0, 11);

    // Pinball loss: actual > pred -> tau * diff; actual < pred -> (1 - tau) * (-diff)
    const pred = 100;
    expect(pinballLossLog(pred, pred * Math.exp(0.3), 0.975)).toBeCloseTo(0.975 * 0.3, 12);
    expect(pinballLossLog(pred, pred * Math.exp(-0.3), 0.025)).toBeCloseTo(0.975 * 0.3, 12);
  });

  it('enforces zero leakage when mutating all BTC rows after 2021-12-31 for causal arms B1..B5', () => {
    const baseRows = makeSyntheticBtcHistory();
    const mutatedRows = baseRows.map(row =>
      row.date > '2021-12-31'
        ? {
            ...row,
            open: row.open * 5,
            high: row.high * 9,
            low: row.low * 0.1,
            close: row.close * 7,
          }
        : row
    );

    const causalArms: StructuralBandArmId[] = [
      'B1_logt_qr',
      'B2_stretched_log_const',
      'B3_stretched_log_decay',
      'B4_logt_decay',
      'B5_stretched_log_rvol',
    ];

    const evalDates = ['2022-01-01', '2023-06-15', '2025-10-06', '2026-06-25'];
    for (const arm of causalArms) {
      const fitA = fitStructuralBandArm(arm, baseRows, { trainStartDate: '2011-01-01', trainEndDate: '2021-12-31', alpha: 0.05 });
      const fitB = fitStructuralBandArm(arm, mutatedRows, { trainStartDate: '2011-01-01', trainEndDate: '2021-12-31', alpha: 0.05 });

      expect(fitA.params).toEqual(fitB.params);
      expect(fitA.trainingRows).toBe(fitB.trainingRows);
      for (const date of evalDates) {
        const t = utcDaysSinceGenesis(date);
        expect(fitA.evaluate(t)).toEqual(fitB.evaluate(t));
      }
    }
  });

  it('detects structural inversions on B0_incumbent and guarantees 0 inversions on B2..B6 through 2045', () => {
    const btcPath = join(process.cwd(), 'src', 'data', 'btc-history.json');
    const btc = JSON.parse(readFileSync(btcPath, 'utf8')) as OHLCVData[];

    const b0 = fitStructuralBandArm('B0_incumbent', btc, { trainStartDate: '2011-01-01', trainEndDate: '2021-12-31' });
    let b0Inversions = 0;
    for (let d = '2011-01-01'; d <= '2045-12-31'; d = addUtcDaysStr(d, 7)) {
      const band = b0.evaluate(utcDaysSinceGenesis(d));
      if (band.floor >= band.center || band.center >= band.peak || band.floor >= band.peak) {
        b0Inversions++;
      }
    }
    expect(b0Inversions).toBeGreaterThan(0);

    const monotoneArms: StructuralBandArmId[] = [
      'B2_stretched_log_const',
      'B3_stretched_log_decay',
      'B4_logt_decay',
      'B5_stretched_log_rvol',
      'B6_shipped_base_anchored',
    ];
    for (const arm of monotoneArms) {
      const model = fitStructuralBandArm(arm, btc, { trainStartDate: '2011-01-01', trainEndDate: '2021-12-31' });
      for (let d = '2011-01-01'; d <= '2045-12-31'; d = addUtcDaysStr(d, 7)) {
        const band = model.evaluate(utcDaysSinceGenesis(d));
        expect(Number.isFinite(band.floor)).toBe(true);
        expect(Number.isFinite(band.center)).toBe(true);
        expect(Number.isFinite(band.peak)).toBe(true);
        expect(band.floor).toBeGreaterThan(0);
        expect(band.floor).toBeLessThan(band.center);
        expect(band.center).toBeLessThan(band.peak);
      }
    }
  });

  it('computes Holm adjustments, Newey-West HAC DM tests, bootstrap intervals, and trailing vol accurately', () => {
    expect(holmAdjust([0.005, 0.02, 0.04, 0.5])).toEqual([0.02, 0.06, 0.08, 0.5]);

    const positiveSeries = Array.from({ length: 100 }, (_, i) => 0.1 + 0.01 * Math.sin(i));
    const nw = neweyWestDmT(positiveSeries, 5);
    expect(nw.tStat).toBeGreaterThan(10);
    expect(nw.pOneSided).toBeLessThan(1e-6);

    const boot = circularBlockBootstrapMeanDiff(positiveSeries, 10, 500, 12345);
    expect(boot.observedMean).toBeCloseTo(0.1, 2);
    expect(boot.lower95).toBeGreaterThan(0.08);
    expect(boot.upper95).toBeLessThan(0.12);

    const closes = [100, 102, 101, 105, 103, 106];
    const vol = trailingDailyLogVol(closes, 5, 5);
    expect(vol).toBeGreaterThan(0);
    expect(trailingDailyLogVol(closes, 1, 5)).toBe(0.05);
    expect(empiricalQuantile([10, 20, 30, 40, 50], 0.5)).toBe(30);
  });
});
