import type { MarketAssetId, OHLCVData } from './api';

export const FORECAST_PATH_GENERATOR_VERSION = 'prefix-stable-v1' as const;

export interface ForecastPathIdentity {
  assetId: MarketAssetId;
  originDate: string;
  dataVersion: string;
  methodId: string;
  generatorVersion: typeof FORECAST_PATH_GENERATOR_VERSION;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A compact version of the causal input rows. Callers must pass only rows
 * available at the forecast origin. */
export function forecastDataVersion(rows: OHLCVData[]): string {
  let hash = 2166136261;
  for (const row of rows) {
    for (const value of `${row.date}:${row.close};`) {
      hash ^= value.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${rows.length}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Horizon is intentionally absent: it controls materialized length, not path identity. */
export function forecastPathSeed(identity: ForecastPathIdentity, traceIndex: number): number {
  if (!Number.isInteger(traceIndex) || traceIndex < 0) throw new Error('traceIndex must be a non-negative integer');
  return hashString([
    identity.generatorVersion,
    identity.assetId,
    identity.originDate,
    identity.dataVersion,
    identity.methodId,
    traceIndex,
  ].join('|'));
}
