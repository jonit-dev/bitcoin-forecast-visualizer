import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { loadMarketData } from '../../lib/api';

vi.mock('../Chart', () => ({ ForecastChart: () => <div data-testid="forecast-chart" /> }));
vi.mock('../workspace/CrisisRiskPanel', () => ({ CrisisRiskPanel: () => <div data-testid="crisis-risk-panel" /> }));
vi.mock('../workspace/CrisisChartPanel', () => ({ CrisisChartPanel: () => <div data-testid="crisis-chart-panel" /> }));
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

  it('should hydrate VOO once and share its exact data and status with the crisis tab', async () => {
    const latest = loadMarketData('sp500').ohlcv.at(-1)!;
    const date = new Date(`${latest.date}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
    const quoteDate = date.toISOString().slice(0, 10);
    const close = latest.close + 123;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const asset = new URL(String(input), 'https://example.test').searchParams.get('asset');
      return Response.json(asset === 'sp500'
        ? { rows: [{ date: quoteDate, open: close, high: close, low: close, close, volume: 1 }], latestDate: quoteDate, source: 'shared-voo-test', refreshedAt: null, status: 'current' }
        : { rows: [], source: 'bundle', refreshedAt: null, status: 'fallback' });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input), 'https://example.test').searchParams.get('asset')).sort()).toEqual(['btc', 'gold', 'sp500']);

    fireEvent.click(screen.getByRole('tab', { name: 'Crisis' }));
    // The crisis surface shows the imported classifier, never a VOO price forecast.
    expect(screen.getByTestId('crisis-chart-panel')).toBeTruthy();
    expect(screen.queryByTestId('forecast-chart')).toBeNull();
    expect(vi.mocked(buildMarketForecast).mock.calls.some((call) => call[0] === 'sp500-crisis')).toBe(false);
    await waitFor(() => {
      const quoteStatus = document.querySelector('.quote-freshness');
      expect(quoteStatus?.textContent).toContain('Current');
      expect(quoteStatus?.querySelector('time')?.getAttribute('datetime')).toBe(quoteDate);
    });

    fireEvent.click(screen.getByRole('tab', { name: 'S&P 500' }));
    await waitFor(() => expect(vi.mocked(buildMarketForecast).mock.calls.some((call) => call[0] === 'sp500' && call[1].currentPrice === close)).toBe(true));
    await waitFor(() => {
      const quoteStatus = document.querySelector('.quote-freshness');
      expect(quoteStatus?.textContent).toContain('Current');
      expect(quoteStatus?.querySelector('time')?.getAttribute('datetime')).toBe(quoteDate);
    });
  }, 15000);
});
