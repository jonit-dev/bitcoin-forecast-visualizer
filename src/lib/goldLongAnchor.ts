import type { OHLCVData } from './api';
import type { GoldMonthlyRow } from './goldLongHorizonModel';
import goldLongHorizonMonthly from '../data/gold-long-horizon-monthly.json';

export const GOLD_M2_ANCHOR_CONFIG = {
  lambda: 0.25,
  tauMonths: 120,
  daysPerMonth: 30.4375,
  decayDays: 120 * 30.4375,
  anchorStartYm: '1972-01',
  minExpandingObs: 12,
  maxStalenessMonths: 3,
} as const;

export interface GoldLongRunMeanReversion {
  amplitude: number;
  decayDays: number;
  gap: number;
  ratioToMean: number;
  m2Month: string;
}

const MONTHLY_ROWS = (goldLongHorizonMonthly as { rows: GoldMonthlyRow[] }).rows;

function monthDiff(laterYm: string, earlierYm: string): number {
  const [ly, lm] = laterYm.split('-').map(Number);
  const [ey, em] = earlierYm.split('-').map(Number);
  return (ly - ey) * 12 + (lm - em);
}

/**
 * Causal post-1Y Gold/M2 valuation mean-reversion adjustment selected on
 * pre-2004 data and validated by scripts/research-gold-m2-production-gate.ts.
 * Fails closed to null (reverting to pure +4%/yr long drift) when M2 is
 * missing, stale (>3 months behind originYm), or history is too short.
 */
export function computeGoldM2MeanReversion(
  ohlcv: OHLCVData[],
  monthlyRows: readonly GoldMonthlyRow[] = MONTHLY_ROWS
): GoldLongRunMeanReversion | null {
  if (!ohlcv || ohlcv.length < 252) return null;
  const last = ohlcv[ohlcv.length - 1];
  if (!last || !(last.close > 0)) return null;

  const originYm = last.date.slice(0, 7);
  let lastMIdx = -1;
  for (let k = 0; k < monthlyRows.length; k += 1) {
    if (monthlyRows[k].ym < originYm) {
      lastMIdx = k;
    } else {
      break;
    }
  }
  if (lastMIdx < 1) return null;

  let start = -1;
  for (let k = 0; k <= lastMIdx; k += 1) {
    if (monthlyRows[k].ym >= GOLD_M2_ANCHOR_CONFIG.anchorStartYm) {
      start = k;
      break;
    }
  }
  if (start < 0) return null;
  const loopStart = Math.max(1, start);

  let sumV = 0;
  let cnt = 0;
  for (let s = loopStart; s <= lastMIdx; s += 1) {
    const m2 = monthlyRows[s - 1]?.m2;
    const gold = monthlyRows[s].gold;
    if (gold > 0 && m2 !== null && Number.isFinite(m2) && m2 > 0) {
      sumV += Math.log(gold) - Math.log(m2);
      cnt += 1;
    }
  }
  if (cnt < GOLD_M2_ANCHOR_CONFIG.minExpandingObs) return null;

  let curM2Idx = -1;
  const minScan = Math.max(0, lastMIdx - 2);
  for (let j = lastMIdx; j >= minScan; j -= 1) {
    const val = monthlyRows[j]?.m2;
    if (val !== null && Number.isFinite(val) && val > 0) {
      curM2Idx = j;
      break;
    }
  }
  if (curM2Idx < 0) return null;

  const curM2 = monthlyRows[curM2Idx].m2!;
  const m2Month = monthlyRows[curM2Idx].ym;
  const ageMonths = monthDiff(originYm, m2Month);
  if (ageMonths < 1 || ageMonths > GOLD_M2_ANCHOR_CONFIG.maxStalenessMonths) {
    return null;
  }

  const refGoldSpot = monthlyRows[lastMIdx].gold;
  if (!(refGoldSpot > 0)) return null;
  const refYm = monthlyRows[lastMIdx].ym;
  let refGldClose: number | null = null;
  for (let k = ohlcv.length - 1; k >= 0; k -= 1) {
    if (ohlcv[k].date.slice(0, 7) <= refYm && ohlcv[k].close > 0) {
      refGldClose = ohlcv[k].close;
      break;
    }
  }

  const spotNow = refGldClose !== null ? refGoldSpot * (last.close / refGldClose) : refGoldSpot;
  const vBar = sumV / cnt;
  const vNow = Math.log(spotNow) - Math.log(curM2);
  const gap = vNow - vBar;

  return {
    amplitude: GOLD_M2_ANCHOR_CONFIG.lambda * gap,
    decayDays: GOLD_M2_ANCHOR_CONFIG.decayDays,
    gap,
    ratioToMean: Math.exp(gap),
    m2Month,
  };
}
