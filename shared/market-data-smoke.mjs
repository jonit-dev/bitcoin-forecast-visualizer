import { assessContinuity } from './market-continuity.mjs';
import { countUsMarketSessionsAfter } from './us-market-calendar.mjs';

const DAY_MS = 86_400_000;
const dayAge = (date, today) => Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);

/**
 * Decide whether one deployed asset snapshot is healthy. A latest date alone is
 * not enough: the interval behind it must be free of holes and the forecast
 * endpoint must be anchored on the same candle the market endpoint reports.
 */
export function evaluateMarketSnapshot(snapshot) {
  const { assetId, since, today, staleAfterDays } = snapshot;
  const market = snapshot.market ?? {};
  const forecast = snapshot.forecast ?? {};
  const rows = market.rows ?? [];
  const latestDate = market.latestDate ?? rows.at(-1)?.date ?? null;
  const reasons = [];

  if (market.status === 'unavailable' || market.status === undefined) reasons.push(`market status is ${market.status ?? 'missing'}`);
  if (rows.length === 0) reasons.push('market endpoint returned no candles');

  if (latestDate) {
    const age = assetId === 'btc' ? dayAge(latestDate, today) : countUsMarketSessionsAfter(latestDate, today);
    if (age > staleAfterDays) reasons.push(`stale: latest candle ${latestDate} is ${age} behind ${today} (limit ${staleAfterDays})`);
  } else {
    reasons.push('market endpoint reported no latest date');
  }

  const observed = assessContinuity(assetId, rows, since);
  if (observed.missingDates.length > 0 || observed.truncated) {
    reasons.push(`missing candles since ${since}: ${observed.missingDates.join(', ')}${observed.truncated ? ' (truncated)' : ''}`);
  }

  const reported = market.continuity;
  if (reported && reported.complete === false) {
    reasons.push(`server reports missing candles: ${(reported.missingDates ?? []).join(', ') || 'unspecified'}`);
  }

  if (forecast.latest?.date !== latestDate) {
    reasons.push(`forecast anchor ${forecast.latest?.date ?? 'missing'} does not agree with market latest ${latestDate}`);
  }
  if (forecast.marketData?.latestDate !== latestDate) {
    reasons.push(`forecast marketData latest ${forecast.marketData?.latestDate ?? 'missing'} does not agree with market latest ${latestDate}`);
  }

  return { ok: reasons.length === 0, reasons };
}
