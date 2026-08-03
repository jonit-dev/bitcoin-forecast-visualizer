import { describe, expect, it } from 'vitest';
import { fetchFredObservations, parseFredObservations } from '../../../scripts/lib/fredApi.mjs';
import {
  assertCandidateForecastsDiffer,
  buildCandidateForecast,
  compareRecords,
  evaluatePromotionGate,
  forecastOutputsDiffer,
  selectParameter,
  selectPeriodRecords,
  type EvaluationRecord,
} from '../../../scripts/backtest-fred-macro-experiments';
import type { ForecastDistribution } from '../backtestMetrics';
import {
  buildMacroSignalAtOrigin,
  buildMacroSignalSeries,
  priorOnlyZScore,
  selectLatestAvailableMacroRow,
  type FredMacroRow,
} from '../fredMacroFeatures';

describe('fred macro features', () => {
  it('future rows are excluded from an origin', () => {
    const rows: FredMacroRow[] = [
      { date: '2020-01-01', availableAfter: '2020-01-31T00:00:00.000Z', metrics: { highYieldSpread: 1 } },
      { date: '2020-01-15', availableAfter: '2020-02-14T00:00:00.000Z', metrics: { highYieldSpread: 2 } },
    ];

    const selection = selectLatestAvailableMacroRow(rows, '2020-02-01');

    expect(selection?.row.date).toBe('2020-01-01');
  });

  it('current value is excluded from the prior z-score', () => {
    const zScore = priorOnlyZScore([1, 2, 100], 2, 252, 2);

    expect(zScore).toBeCloseTo(197, 8);
    expect(zScore).toBeGreaterThan(100);
  });

  it('constructs finite stress, liquidity, and shock signals from prior rows', () => {
    const rows = Array.from({ length: 320 }, (_, index) => {
      const date = new Date(Date.UTC(2019, 0, 1 + index)).toISOString().split('T')[0];
      return {
        date,
        availableAfter: `${new Date(Date.UTC(2019, 0, 2 + index)).toISOString().split('T')[0]}T00:00:00.000Z`,
        metrics: {
          highYieldSpread: 3 + Math.sin(index / 15) + index / 500,
          nfci: Math.cos(index / 17) + index / 700,
          vix: 16 + Math.sin(index / 11) * 3 + index / 100,
          baaSpread: 2 + Math.cos(index / 13) * 0.2 + index / 800,
          dollarMomentum30d: Math.sin(index / 19) * 0.02 + index / 10000,
          yieldCurve10y2y: 0.8 - Math.sin(index / 23) * 0.4,
          fedBalanceSheetChange13w: Math.cos(index / 21) * 0.02 + index / 10000,
          m2Change26w: Math.sin(index / 18) * 0.03 + index / 12000,
          fedFundsChange13w: Math.cos(index / 12) * 0.3,
          yieldCurveChange30d: Math.sin(index / 9) * 0.2,
        },
      } satisfies FredMacroRow;
    });

    const signalSeries = buildMacroSignalSeries(rows);
    const signal = buildMacroSignalAtOrigin(rows, '2019-11-16', signalSeries);

    expect(signal?.stressComposite).toEqual(expect.any(Number));
    expect(signal?.liquidityComposite).toEqual(expect.any(Number));
    expect(signal?.stressShockZ30d).toEqual(expect.any(Number));
  });

  it('prefers the BAAFF proxy metric and falls back to the legacy alias', () => {
    const makeRows = (metric: 'proxy' | 'legacy'): FredMacroRow[] => Array.from({ length: 320 }, (_, index) => {
      const date = new Date(Date.UTC(2019, 0, 1 + index)).toISOString().split('T')[0];
      const creditSpread = metric === 'proxy'
        ? 10 + Math.sin(index / 11) + index / 200
        : 1000 + index * 0.25;
      return {
        date,
        availableAfter: `${new Date(Date.UTC(2019, 0, 2 + index)).toISOString().split('T')[0]}T00:00:00.000Z`,
        metrics: {
          ...(metric === 'proxy' ? { baaMinusFedFundsCreditSpread: creditSpread, highYieldSpread: 1000 + index * 0.25 } : { highYieldSpread: creditSpread }),
          nfci: Math.cos(index / 17) + index / 700,
          vix: 16 + Math.sin(index / 11) * 3 + index / 100,
          baaSpread: 2 + Math.cos(index / 13) * 0.2 + index / 800,
          dollarMomentum30d: Math.sin(index / 19) * 0.02 + index / 10000,
          yieldCurve10y2y: 0.8 - Math.sin(index / 23) * 0.4,
        },
      };
    });
    const proxyRows = makeRows('proxy');
    const legacyRows = makeRows('legacy');
    const proxySignal = buildMacroSignalAtOrigin(proxyRows, '2019-11-18');
    const legacySignal = buildMacroSignalAtOrigin(legacyRows, '2019-11-18');
    const proxyExpected = priorOnlyZScore(
      proxyRows.map(row => row.metrics.baaMinusFedFundsCreditSpread),
      proxyRows.length - 1,
      252,
      30,
    );
    const legacyExpected = priorOnlyZScore(
      legacyRows.map(row => row.metrics.highYieldSpread),
      legacyRows.length - 1,
      252,
      30,
    );

    expect(proxySignal?.components.creditSpreadProxy).toBeCloseTo(proxyExpected as number, 8);
    expect(proxySignal?.components.creditSpreadProxy).not.toBeCloseTo(legacyExpected as number, 4);
    expect(legacySignal?.components.creditSpreadProxy).toBeCloseTo(legacyExpected as number, 8);
  });

  it('rejects an empty FRED observation response before cache alignment', async () => {
    expect(() => parseFredObservations({ observations: [] }, 'WALCL')).toThrow(
      'FRED WALCL returned no finite observations after 2010-07-17.',
    );

    await expect(fetchFredObservations(
      'WALCL',
      'fixture-key',
      (async () => ({ ok: true, json: async () => ({ observations: [] }) })) as any,
    )).rejects.toThrow('FRED WALCL returned no finite observations after 2010-07-17.');
  });

  it('does not select zero or pass the gate when an arm has no validation signal rows', () => {
    const selection = selectParameter('stress-interval', 30, []);

    expect(selection).toEqual({
      status: 'insufficient-data',
      parameter: null,
      validationSignalSamples: 0,
      reason: 'no usable validation signal rows; parameter selection is not defined',
    });

    const holdout = Object.fromEntries([14, 30, 60, 90].map(horizon => [
      String(horizon),
      compareRecords([], 'stress-interval', selection.parameter, 'holdout', horizon as 14 | 30 | 60 | 90, selection.reason),
    ]));
    const gate = evaluatePromotionGate(holdout);

    expect(gate.passed).toBe(false);
    expect(holdout['30'].status).toBe('insufficient-data');
    expect(holdout['30'].candidate).toBeNull();
  });

  it('compares candidate identity from forecast outputs, not arm labels', () => {
    const baseline: ForecastDistribution = {
      median: 100,
      sigma: 0.2,
      quantiles: { q025: 67, q05: 72, q10: 77, q50: 100, q90: 130, q95: 139, q975: 149 },
    };
    const inactive = buildCandidateForecast(baseline, null, 'stress-interval', 0, 14);
    const activeSignal = {
      rowDate: '2022-01-01',
      availableAfter: '2022-01-02T00:00:00.000Z',
      rowIndex: 1,
      stressComposite: 2,
      liquidityComposite: null,
      stressCompositeChange30d: null,
      stressShockZ30d: null,
      components: {},
    };
    const active = buildCandidateForecast(baseline, activeSignal, 'stress-interval', 0.5, 14);

    expect(forecastOutputsDiffer(baseline, inactive)).toBe(false);
    expect(forecastOutputsDiffer(baseline, active)).toBe(true);
    expect(() => assertCandidateForecastsDiffer(baseline, inactive)).toThrow(
      'candidate and baseline identities were equal',
    );
    expect(() => assertCandidateForecastsDiffer(baseline, active)).not.toThrow();
  });

  it('splits late-2022 origins by target date for every requested horizon', () => {
    const addDays = (date: string, days: number): string => {
      const value = new Date(`${date}T00:00:00.000Z`).getTime() + days * 86400000;
      return new Date(value).toISOString().slice(0, 10);
    };
    const records = [14, 30, 60, 90].map(horizon => ({
      originDate: '2022-12-20',
      targetDate: addDays('2022-12-20', horizon),
      horizonDays: horizon,
    })) as Array<Pick<EvaluationRecord, 'originDate' | 'targetDate'>>;

    const validation = selectPeriodRecords(records, 'validation');
    const holdout = selectPeriodRecords(records, 'holdout');

    expect(validation).toHaveLength(0);
    expect(holdout).toHaveLength(0);
    expect(validation.every(record => record.targetDate <= '2022-12-31')).toBe(true);
    expect(holdout.every(record => record.targetDate >= '2023-01-01')).toBe(true);
    expect(records.map(record => record.targetDate)).toEqual([
      '2023-01-03',
      '2023-01-19',
      '2023-02-18',
      '2023-03-20',
    ]);
  });
});
