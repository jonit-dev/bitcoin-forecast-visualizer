import { createForecastApiApp } from './app';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

createForecastApiApp().listen(port, host, () => {
  console.log(`Bitcoin forecast API listening on http://${host}:${port}`);
});
