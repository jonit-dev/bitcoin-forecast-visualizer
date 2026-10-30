import { beforeEach, describe, expect, it, vi } from 'vitest';

const chartCalls = { processRealData: 0, generateHeatmapData: 0 };
vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  return {
    ...actual,
    processRealData: (...args: Parameters<typeof actual.processRealData>) => {
      chartCalls.processRealData += 1;
      return actual.processRealData(...args);
    },
    generateHeatmapData: (...args: Parameters<typeof actual.generateHeatmapData>) => {
      chartCalls.generateHeatmapData += 1;
      return actual.generateHeatmapData(...args);
    },
  };
});

const { loadMarketData } = await import('../api');
const { buildMarketForecast, buildMarketForecastSummary } = await import('../marketForecast');
const { onRequestGet } = await import('../../../functions/api/forecast');

const Z95 = 1.6448536269514722;
const forecastRequest = (query: string) => ({ request: new Request(`https://example.test/api/forecast?${query}`) });

beforeEach(() => {
  chartCalls.processRealData = 0;
  chartCalls.generateHeatmapData = 0;
});

describe('summary forecast path', () => {
  it('should answer a summary request without generating chart rows or heatmap cells', async () => {
    const response = await onRequestGet(forecastRequest('asset=btc&horizon=180&confidence=0.95'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.forecast.median).toBeGreaterThan(0);
    // A summary discards the chart, so it must not pay for it: in the
    // synchronous Express server that work blocks unrelated requests.
    expect(chartCalls).toEqual({ processRealData: 0, generateHeatmapData: 0 });
  }, 60_000);

  it('should keep the summary identical to the full build it replaced', () => {
    const cases: [Parameters<typeof buildMarketForecast>[0], Parameters<typeof buildMarketForecast>[2]][] = [
      ['btc', 180],
      ['sp500', 60],
      ['gold', 365],
    ];

    for (const [assetId, horizon] of cases) {
      const marketData = loadMarketData(assetId);
      const full = buildMarketForecast(assetId, marketData, horizon, Z95);
      const summary = buildMarketForecastSummary(assetId, marketData, horizon, Z95);

      expect(summary.probabilityForecast).toEqual(full.probabilityForecast);
      expect(summary.drawdownStats).toEqual(full.drawdownStats);
      expect(summary.displayData).toEqual([]);
      expect(summary.heatmapData).toEqual([]);
    }
  }, 120_000);
});
