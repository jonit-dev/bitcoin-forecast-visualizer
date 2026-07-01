import express from 'express';
import { ForecastController } from './ForecastController';
import { registerControllers } from './decorators';

export function createForecastApiApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  registerControllers(app, [new ForecastController()]);

  return app;
}
