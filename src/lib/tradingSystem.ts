import btcHistory from '../data/btc-history.json';
import featureTable from '../data/feature-table.json';
import { computeBuyZonePoints } from './buyZone';
import type { OHLCVData } from './api';
import type { FeatureRow } from './features';

const INITIAL_CAPITAL = 1000;
const FEE_RATE = 0.001;
const BORROW_APR = 0.08;
const MAINTENANCE_MARGIN = 0.15;
const START_DATE = '2015-01-14';
const HOT_CONFIRM_DAYS = 14;
const COOL_CONFIRM_DAYS = 45;
const BREAK_CONFIRM_DAYS = 10;
const REENTRY_COOLDOWN_DAYS = 30;
const TRIM_TARGET = 0.35;

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
const featuresByDate = new Map((featureTable as FeatureRow[]).map(row => [row.date, row.features]));
const buyPointByDate = new Map(computeBuyZonePoints().map(point => [point.date, point]));

interface SignalState {
  trendConfirmed: boolean;
  valueConfirmed: boolean;
  valuationHot: boolean;
  trendBroken: boolean;
}

function yearsBetween(startDate: string, endDate: string): number {
  return Math.max(1 / 365, (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (365.25 * 86400000));
}

function cagr(finalValue: number, years: number): number {
  return finalValue > 0 ? Math.pow(finalValue / INITIAL_CAPITAL, 1 / years) - 1 : -1;
}

function movingAverage(endIndex: number, days: number): number | null {
  if (endIndex < days - 1) return null;
  let sum = 0;
  for (let i = endIndex - days + 1; i <= endIndex; i++) sum += rows[i].close;
  return sum / days;
}

function signalState(date: string, rowIndex: number): SignalState {
  const score = buyPointByDate.get(date)?.bottomScore ?? null;
  const features = featuresByDate.get(date) ?? {};
  const sma100 = movingAverage(rowIndex, 100);
  const sma150 = movingAverage(rowIndex, 150);
  const close = rows[rowIndex].close;
  const trendConfirmed = sma100 !== null && sma150 !== null && close > sma150 && sma100 > sma150;
  const trendBroken = sma150 !== null && close < sma150;
  const valueConfirmed = score !== null && score >= 0.65;
  const valueStillStrong = score !== null && score >= 0.70;
  const valuationHot = (features.mvrvPercentile ?? 0) >= 0.90 || (features.priceResidualLog ?? 0) > 0.75;
  const greedHot = (features.fearGreedIndex ?? 0) >= 80 && (features.mvrvPercentile ?? 0) >= 0.75;

  return {
    trendConfirmed,
    valueConfirmed,
    valuationHot: valuationHot || greedHot,
    trendBroken: trendBroken && !valueStillStrong,
  };
}

function targetExposure(
  previousTarget: number,
  signal: SignalState,
  hotDays: number,
  coolDays: number,
  breakDays: number,
  flatDays: number,
): number {
  let target = previousTarget;
  const riskOn = signal.trendConfirmed || signal.valueConfirmed;

  if (target === 0) {
    if (flatDays >= REENTRY_COOLDOWN_DAYS && riskOn && breakDays === 0) target = 1;
    return target;
  }

  if (hotDays >= HOT_CONFIRM_DAYS && target > TRIM_TARGET) target = TRIM_TARGET;
  if (target === TRIM_TARGET && coolDays >= COOL_CONFIRM_DAYS && riskOn) target = 1;
  if (breakDays >= BREAK_CONFIRM_DAYS) target = 0;
  return target;
}

function tradeToTarget(cash: number, btc: number, price: number, target: number) {
  const equity = cash + btc * price;
  const current = equity > 0 ? (btc * price) / equity : 0;
  const delta = target - current;
  if (Math.abs(delta) < 0.1) return { cash, btc, fee: 0, traded: false };

  if (delta > 0) {
    const notional = Math.min(equity * delta, cash / (1 + FEE_RATE));
    const fee = notional * FEE_RATE;
    return { cash: cash - notional - fee, btc: btc + notional / price, fee, traded: true };
  }

  const notional = Math.min(btc * price, equity * -delta);
  const fee = notional * FEE_RATE;
  return { cash: cash + notional - fee, btc: btc - notional / price, fee, traded: true };
}

export function computeTradingSystemSummary(): TradingSystemSummary {
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
  let hotDays = 0;
  let coolDays = 0;
  let breakDays = 0;
  let flatDays = 999;
  const points: TradingSystemPoint[] = [];
  const markers: TradingSystemMarker[] = [];

  const buyHoldBtc = INITIAL_CAPITAL * (1 - FEE_RATE) / testRows[0].open;
  let buyHoldPeak = INITIAL_CAPITAL;
  let buyHoldMaxDrawdown = 0;

  for (let i = 1; i < testRows.length; i++) {
    const signal = testRows[i - 1];
    const row = testRows[i];
    const signalIndex = rows.findIndex(item => item.date === signal.date);

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

    const signalFlags = signalState(signal.date, signalIndex);
    hotDays = signalFlags.valuationHot ? hotDays + 1 : 0;
    coolDays = signalFlags.valuationHot ? 0 : coolDays + 1;
    breakDays = signalFlags.trendBroken ? breakDays + 1 : 0;

    const nextTarget = targetExposure(target, signalFlags, hotDays, coolDays, breakDays, flatDays);
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
    if (target === 0) flatDays++;
    else flatDays = 0;

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
    name: 'Confirmed Trend/Value Risk System',
    description: 'No-leverage trend/value system: target 100% BTC on confirmed trend or deep value, trim to 35% after 14 hot-valuation days, raise back after 45 cool days, and exit after 10 confirmed trend-break days.',
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
