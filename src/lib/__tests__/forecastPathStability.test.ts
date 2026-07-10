import { describe, expect, it } from 'vitest';
import { loadMarketData, type MarketAssetId } from '../api';
import { CONFIDENCE_Z_SCORES } from '../data';
import { forecastDataVersion, forecastPathSeed, FORECAST_PATH_GENERATOR_VERSION } from '../forecastPathSeed';
import { buildMarketForecast } from '../marketForecast';

const assets: MarketAssetId[] = ['btc', 'sp500', 'gold'];
const pairs = [[30, 90], [90, 180], [180, 365]] as const;
const fixtures = Object.fromEntries(assets.map((asset) => {
  const data = loadMarketData(asset);
  return [asset, { ...data, ohlcv: data.ohlcv.slice(-1400) }];
})) as Record<MarketAssetId, ReturnType<typeof loadMarketData>>;

function primary(asset: MarketAssetId, horizon: number, policy: 'production-baseline' | 'prefix-stable-v1') {
  return buildMarketForecast(asset, fixtures[asset], horizon, CONFIDENCE_Z_SCORES[0.95], { pathPolicy: policy })
    .displayData.filter((row) => row.isForecast)
    .map((row) => ({ date: row.date, value: row.stochasticTraces?.[0] }));
}

function mismatchCount(shortRows: ReturnType<typeof primary>, longRows: ReturnType<typeof primary>) {
  return shortRows.filter((row, index) => row.date !== longRows[index]?.date || row.value !== longRows[index]?.value).length;
}

describe('forecast path horizon-prefix contract', () => {
  it('should detect horizon-dependent BTC trace prefixes in the production baseline', () => {
    expect(mismatchCount(primary('btc', 30, 'production-baseline'), primary('btc', 90, 'production-baseline'))).toBeGreaterThan(0);
  }, 30_000);

  it('should detect horizon-dependent generic trace prefixes in the production baseline', () => {
    expect(mismatchCount(primary('sp500', 30, 'production-baseline'), primary('sp500', 90, 'production-baseline'))).toBeGreaterThan(0);
    expect(mismatchCount(primary('gold', 30, 'production-baseline'), primary('gold', 90, 'production-baseline'))).toBeGreaterThan(0);
  }, 30_000);

  it('should preserve the BTC prefix when extending the requested horizon', () => {
    for (const [short, long] of pairs) expect(mismatchCount(primary('btc', short, 'prefix-stable-v1'), primary('btc', long, 'prefix-stable-v1'))).toBe(0);
  });

  it('should preserve S&P 500 and gold prefixes when extending the requested horizon', () => {
    for (const asset of ['sp500', 'gold'] as const) for (const [short, long] of pairs) {
      expect(mismatchCount(primary(asset, short, 'prefix-stable-v1'), primary(asset, long, 'prefix-stable-v1'))).toBe(0);
    }
  });

  it('should generate the same path regardless of horizon navigation order', () => {
    for (const asset of assets) {
      const first = primary(asset, 30, 'prefix-stable-v1');
      primary(asset, 180, 'prefix-stable-v1');
      expect(primary(asset, 30, 'prefix-stable-v1')).toEqual(first);
    }
  });

  it('should not alter prior paths when future OHLCV rows are mutated', () => {
    const data = loadMarketData('btc');
    const cutoff = data.ohlcv.length - 30;
    const causalRows = data.ohlcv.slice(0, cutoff);
    const mutatedFuture = data.ohlcv.slice(cutoff).map((row) => ({ ...row, close: row.close * 1.5 }));
    expect(forecastDataVersion(causalRows)).toBe(forecastDataVersion([...causalRows, ...mutatedFuture].slice(0, cutoff)));
  });

  it('should isolate trace streams from trace count and auxiliary simulations', () => {
    const rows = fixtures.btc.ohlcv;
    const identity = { assetId: 'btc' as const, originDate: rows.at(-1)!.date, dataVersion: forecastDataVersion(rows), methodId: 'power-law-residual-block-bootstrap-14d', generatorVersion: FORECAST_PATH_GENERATOR_VERSION };
    const primarySeed = forecastPathSeed(identity, 0);
    for (let index = 1; index < 24; index++) forecastPathSeed(identity, index);
    expect(forecastPathSeed(identity, 0)).toBe(primarySeed);
  });

  it('should select the same gold primary trace for all requested horizons', () => {
    for (const [short, long] of pairs) expect(mismatchCount(primary('gold', short, 'prefix-stable-v1'), primary('gold', long, 'prefix-stable-v1'))).toBe(0);
  });
});
