import {
  MAX_BACKFILL_DAYS as MAX_BACKFILL_DAYS_VALUE,
  applyContinuityGuard as applyGuard,
  assessContinuity as assess,
  backfillWindowStart as backfillStart,
  daysBetween as days,
  repairWindowStart as windowStart,
  shiftDate as shift,
} from '../../shared/market-continuity.mjs';
import type { MarketAssetId } from './api';

export interface ContinuityAssessment {
  /** True when every expected candle between `since` and the newest row is present. */
  complete: boolean;
  /** Expected candle dates the series does not contain, capped at MAX_BACKFILL_DAYS. */
  missingDates: string[];
  /** Newest candle reachable from `since` without crossing a hole. */
  lastContiguousDate: string | null;
  /** True when the gap was larger than the reporting cap. */
  truncated: boolean;
}

export interface DatedRow { date: string }

export const MAX_BACKFILL_DAYS: number = MAX_BACKFILL_DAYS_VALUE;
export const shiftDate = (date: string, offsetDays: number): string => shift(date, offsetDays);
export const repairWindowStart = (date: string, lookbackDays: number): string => windowStart(date, lookbackDays);
export const daysBetween = (from: string, to: string): number => days(from, to);

export const assessContinuity = (assetId: MarketAssetId, rows: readonly DatedRow[], since?: string): ContinuityAssessment =>
  assess(assetId, rows, since) as ContinuityAssessment;

export const applyContinuityGuard = <T extends DatedRow>(assetId: MarketAssetId, rows: readonly T[], since?: string): { rows: T[]; continuity: ContinuityAssessment } =>
  applyGuard(assetId, rows, since) as { rows: T[]; continuity: ContinuityAssessment };

export const backfillWindowStart = (
  assetId: MarketAssetId,
  storedDates: readonly string[],
  today: string,
  options?: { lookbackDays?: number; bootstrapSince?: string },
): string => backfillStart(assetId, storedDates, today, options) as string;
