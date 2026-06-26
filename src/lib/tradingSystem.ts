import btcHistory from '../data/btc-history.json';
import { computeBuyZonePoints } from './buyZone';
import { addDays, addMonths, ATL_TO_ATH_DAYS, ATH_TO_ATL_DAYS, TRIM_BEFORE_ATH_DAYS, type CyclePivot, type PhaseZone } from './cycle';
import type { OHLCVData } from './api';

const INITIAL_CAPITAL = 1000;
const FEE_RATE = 0.001;
const BORROW_APR = 0.08;
const MAINTENANCE_MARGIN = 0.15;
const START_DATE = '2015-01-14';

export interface TradingSystemPoint {
  date: string;
  value: number;
  buyHoldValue: number;
  exposure: number;
  drawdown: number;
}

export interface TradingSystemMarker {
  date: string;
  fromExposure: number;
  exposure: number;
  deltaExposure: number;
  label: string;
  action: 'buy' | 'trim' | 'raise' | 'reset';
}

export interface TradingSystemSummary {
  name: string;
  description: string;
  initialCapital: number;
  finalValue: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  averageExposure: number;
  trades: number;
  feesPaid: number;
  borrowCost: number;
  liquidated: boolean;
  buyHoldFinalValue: number;
  buyHoldCagr: number;
  buyHoldMaxDrawdown: number;
  points: TradingSystemPoint[];
  markers: TradingSystemMarker[];
}

const rows = btcHistory as OHLCVData[];
const buyPointByDate = new Map(computeBuyZonePoints().map(point => [point.date, point]));

function scheduledPhaseZones(untilYear = 2040): PhaseZone[] {
  const pivots: CyclePivot[] = [{ date: START_DATE, type: 'ATL', known: true }];
  let last = pivots[0];
  while (new Date(`${last.date}T00:00:00Z`).getUTCFullYear() < untilYear) {
    const nextDays = last.type === 'ATL' ? ATL_TO_ATH_DAYS : ATH_TO_ATL_DAYS;
    const nextType = last.type === 'ATL' ? 'ATH' : 'ATL';
    const pivot: CyclePivot = { date: addDays(last.date, nextDays), type: nextType, known: false };
    pivots.push(pivot);
    last = pivot;
  }

  const zones: PhaseZone[] = [];
  for (let i = 0; i < pivots.length; i++) {
    const pivot = pivots[i];
    const next = pivots[i + 1];
    if (pivot.type === 'ATL') {
      const accumEnd = addMonths(pivot.date, 6);
      const athDate = next?.type === 'ATH' ? next.date : addDays(pivot.date, ATL_TO_ATH_DAYS);
      zones.push({ startDate: pivot.date, endDate: accumEnd, label: 'Accumulation' });
      zones.push({ startDate: accumEnd, endDate: addDays(athDate, -TRIM_BEFORE_ATH_DAYS), label: 'Bull' });
      zones.push({ startDate: addDays(athDate, -TRIM_BEFORE_ATH_DAYS), endDate: athDate, label: 'Trim' });
    } else {
      zones.push({ startDate: pivot.date, endDate: next ? next.date : addDays(pivot.date, ATH_TO_ATL_DAYS), label: 'Bear' });
    }
  }
  return zones;
}

function isTrim(date: string, zones: PhaseZone[]): boolean {
  return zones.some(zone => zone.label === 'Trim' && zone.startDate <= date && date < zone.endDate);
}

function yearsBetween(startDate: string, endDate: string): number {
  return Math.max(1 / 365, (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (365.25 * 86400000));
}

function cagr(finalValue: number, years: number): number {
  return finalValue > 0 ? Math.pow(finalValue / INITIAL_CAPITAL, 1 / years) - 1 : -1;
}

function targetExposure(date: string, previousTarget: number, previousWasTrim: boolean, zones: PhaseZone[]): number {
  const trim = isTrim(date, zones);
  if (previousWasTrim && !trim) return 0;
  if (trim) return Math.min(previousTarget, 0.5);

  const score = buyPointByDate.get(date)?.bottomScore ?? null;
  if (score === null || score < 0.75) return previousTarget;

  const scaled = (score - 0.75) / 0.1;
  const entry = Math.min(1.25, Math.max(0, scaled * 1.25));
  return Math.max(previousTarget, entry);
}

function tradeToTarget(cash: number, btc: number, price: number, target: number) {
  const equity = cash + btc * price;
  const current = equity > 0 ? (btc * price) / equity : 0;
  const delta = target - current;
  if (Math.abs(delta) < 0.1) return { cash, btc, fee: 0, traded: false };

  if (delta > 0) {
    const notional = equity * delta;
    const fee = notional * FEE_RATE;
    return { cash: cash - notional - fee, btc: btc + notional / price, fee, traded: true };
  }

  const notional = Math.min(btc * price, equity * -delta);
  const fee = notional * FEE_RATE;
  return { cash: cash + notional - fee, btc: btc - notional / price, fee, traded: true };
}

export function computeTradingSystemSummary(): TradingSystemSummary {
  const zones = scheduledPhaseZones();
  const testRows = rows.filter(row => row.date >= START_DATE);
  let cash = INITIAL_CAPITAL;
  let btc = 0;
  let target = 0;
  let trades = 0;
  let feesPaid = 0;
  let borrowCost = 0;
  let liquidated = false;
  let peak = INITIAL_CAPITAL;
  let maxDrawdown = 0;
  let exposureSum = 0;
  let lastMarkerTargetPct: number | null = null;
  const points: TradingSystemPoint[] = [];
  const markers: TradingSystemMarker[] = [];

  const buyHoldBtc = INITIAL_CAPITAL * (1 - FEE_RATE) / testRows[0].open;
  let buyHoldPeak = INITIAL_CAPITAL;
  let buyHoldMaxDrawdown = 0;

  for (let i = 1; i < testRows.length; i++) {
    const signal = testRows[i - 1];
    const row = testRows[i];
    const wasTrim = isTrim(i >= 2 ? testRows[i - 2].date : signal.date, zones);

    if (cash < 0) {
      const dailyBorrow = -cash * BORROW_APR / 365;
      cash -= dailyBorrow;
      borrowCost += dailyBorrow;
    }

    const openEquity = cash + btc * row.open;
    const lowEquity = cash + btc * row.low;
    const lowMargin = btc > 0 ? lowEquity / (btc * row.low) : Infinity;
    if (openEquity <= 0 || lowEquity <= 0 || lowMargin < MAINTENANCE_MARGIN) {
      liquidated = true;
      break;
    }

    const nextTarget = targetExposure(signal.date, target, wasTrim, zones);
    const trade = tradeToTarget(cash, btc, row.open, nextTarget);
    if (trade.traded) {
      const markerTargetPct = Math.round(nextTarget * 100);
      const targetChanged = Math.abs(nextTarget - target) >= 0.01 && markerTargetPct !== lastMarkerTargetPct;
      const action = nextTarget === 0 && target > 0
        ? 'reset'
        : nextTarget < target
          ? 'trim'
          : target === 0
            ? 'buy'
            : 'raise';
      if (targetChanged) {
        markers.push({
          date: row.date,
          fromExposure: (lastMarkerTargetPct ?? 0) / 100,
          exposure: nextTarget,
          deltaExposure: nextTarget - target,
          action,
          label: `${markerTargetPct}% BTC`,
        });
        lastMarkerTargetPct = markerTargetPct;
      }
      cash = trade.cash;
      btc = trade.btc;
      feesPaid += trade.fee;
      trades++;
    }
    target = nextTarget;

    const value = cash + btc * row.close;
    peak = Math.max(peak, value);
    const drawdown = value / peak - 1;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    const exposure = value > 0 ? (btc * row.close) / value : 0;
    exposureSum += exposure;

    const buyHoldValue = buyHoldBtc * row.close;
    buyHoldPeak = Math.max(buyHoldPeak, buyHoldValue);
    buyHoldMaxDrawdown = Math.min(buyHoldMaxDrawdown, buyHoldValue / buyHoldPeak - 1);

    points.push({
      date: row.date,
      value,
      buyHoldValue,
      exposure,
      drawdown,
    });
  }

  const finalValue = points.at(-1)?.value ?? INITIAL_CAPITAL;
  const buyHoldFinalValue = points.at(-1)?.buyHoldValue ?? INITIAL_CAPITAL;
  const years = yearsBetween(testRows[0].date, testRows.at(-1)?.date ?? testRows[0].date);

  return {
    name: 'Robust Cycle Risk System',
    description: 'Stateful risk-scaled buy-zone system: enter above 75 bottom score, cap at 1.25x, and cap exposure at 50% during scheduled Trim windows without increasing into them.',
    initialCapital: INITIAL_CAPITAL,
    finalValue,
    totalReturn: finalValue / INITIAL_CAPITAL - 1,
    cagr: cagr(finalValue, years),
    maxDrawdown,
    averageExposure: exposureSum / Math.max(1, points.length),
    trades,
    feesPaid,
    borrowCost,
    liquidated,
    buyHoldFinalValue,
    buyHoldCagr: cagr(buyHoldFinalValue, years),
    buyHoldMaxDrawdown,
    points,
    markers,
  };
}
