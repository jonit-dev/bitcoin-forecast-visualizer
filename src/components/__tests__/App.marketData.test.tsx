import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { loadMarketData } from '../../lib/api';

vi.mock('../Chart', () => ({ ForecastChart: () => <div data-testid="forecast-chart" /> }));
vi.mock('../../lib/marketForecast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/marketForecast')>();
  return { ...actual, buildMarketForecast: vi.fn(actual.buildMarketForecast) };
});

import App from '../../App';
import { buildMarketForecast } from '../../lib/marketForecast';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('App market data hydration', () => {
  it('should display fallback status when hydration fails while the chart remains rendered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<App />);
    expect(screen.getByTestId('forecast-chart')).toBeTruthy();
    expect(await screen.findByText(/Bundled fallback/)).toBeTruthy();
  });

  it('should recalculate the active forecast when hydration adds a candle', async () => {
    const latest = loadMarketData('btc').ohlcv.at(-1)!;
    const date = new Date(`${latest.date}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
    const close = latest.close + 321;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const asset = new URL(String(input), 'https://example.test').searchParams.get('asset');
      return Response.json(asset === 'btc'
        ? { rows: [{ date: date.toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 1 }], latestDate: date.toISOString().slice(0, 10), source: 'test', refreshedAt: null, status: 'current' }
        : { rows: [], source: 'bundle', refreshedAt: null, status: 'fallback' });
    }));
    render(<App />);
    await waitFor(() => expect(vi.mocked(buildMarketForecast).mock.calls.some((call) => call[0] === 'btc' && call[1].currentPrice === close)).toBe(true), { timeout: 3000 });
  });
});
