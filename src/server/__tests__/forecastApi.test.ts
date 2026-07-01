import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createForecastApiApp } from '../app';

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createForecastApiApp();
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('forecast API', () => {
  it('returns available forecast assets', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/assets`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.assets).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'btc', ticker: 'BTC' }),
        expect.objectContaining({ id: 'sp500', ticker: 'VOO' }),
        expect.objectContaining({ id: 'gold', ticker: 'GLD' }),
      ]));
    });
  });

  it('returns a compact BTC forecast query response', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/forecast?asset=btc&horizon=180&confidence=0.95`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        asset: expect.objectContaining({ id: 'btc', ticker: 'BTC' }),
        input: { horizonDays: 180, confidence: 0.95 },
        latest: expect.objectContaining({ date: expect.any(String), close: expect.any(Number) }),
        forecast: expect.objectContaining({
          targetDate: expect.any(String),
          median: expect.any(Number),
          probabilityUp: expect.any(Number),
          q10: expect.any(Number),
          q90: expect.any(Number),
        }),
      });
      expect(body.forecast.median).toBeGreaterThan(0);
      expect(body.forecast.probabilityUp).toBeGreaterThanOrEqual(0);
      expect(body.forecast.probabilityUp).toBeLessThanOrEqual(1);
    });
  });

  it('rejects invalid forecast query inputs', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/forecast?asset=doge&horizon=0&confidence=0.42`);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('asset');
      expect(body.error).toContain('horizon');
      expect(body.error).toContain('confidence');
    });
  });
});
