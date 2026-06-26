import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import { computeBuyZonePoints } from '../src/lib/buyZone';
import { addDays, addMonths, ATL_TO_ATH_DAYS, ATH_TO_ATL_DAYS, TRIM_BEFORE_ATH_DAYS, type CyclePivot, type PhaseZone } from '../src/lib/cycle';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';

const INITIAL_CAPITAL = 1000;
const FEE_RATE = 0.001;
const BORROW_APR = 0.08;
const MAINTENANCE_MARGIN = 0.15;
const START_DATE = '2015-01-14';
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');

type VariantFamily =
  | 'stateful-value'
  | 'trend-confirmed'
  | 'macro-filtered'
  | 'sentiment-contrarian'
  | 'mvrv-trim'
  | 'liquidity-boost';

interface VariantSpec {
  id: string;
  family: VariantFamily;
  buyThreshold: number;
  maxLeverage: number;
  trimTarget: number;
  baseTarget: number;
  trendFilter: boolean;
  macroFilter: boolean;
  sentimentFilter: boolean;
  mvrvTrimThreshold: number | null;
  liquidityBoost: number;
}

interface DayState {
  date: string;
  row: OHLCVData;
  bottomScore: number | null;
  isTrim: boolean;
  sma200: number | null;
  features: Record<string, number>;
}

interface VariantResult {
  spec: VariantSpec;
  finalValue: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  exposure: number;
  trades: number;
  feesPaid: number;
  borrowCost: number;
  liquidated: boolean;
  beatsBuyHold: boolean;
  buyHoldFinalValue: number;
  buyHoldCagr: number;
  buyHoldMaxDrawdown: number;
}

const rows = btcHistory as OHLCVData[];
const features = featureTable as FeatureRow[];
const featureByDate = new Map(features.map(row => [row.date, row]));
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

function isTrim(date: string, zones: PhaseZone[]) {
  return zones.some(zone => zone.label === 'Trim' && zone.startDate <= date && date < zone.endDate);
}

function buildStates(): DayState[] {
  const zones = scheduledPhaseZones();
  return rows.map((row, index) => {
    const sma200 = index >= 199
      ? rows.slice(index - 199, index + 1).reduce((sum, item) => sum + item.close, 0) / 200
      : null;
    return {
      date: row.date,
      row,
      bottomScore: buyPointByDate.get(row.date)?.bottomScore ?? null,
      isTrim: isTrim(row.date, zones),
      sma200,
      features: featureByDate.get(row.date)?.features ?? {},
    };
  }).filter(state => state.date >= START_DATE);
}

function years(startDate: string, endDate: string) {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (365.25 * 86400000);
}

function maxDrawdown(values: number[]) {
  let peak = values[0] ?? 0;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

function valueTarget(spec: VariantSpec, state: DayState) {
  const score = state.bottomScore;
  if (score === null || score < spec.buyThreshold) return spec.baseTarget;
  const scaled = (score - spec.buyThreshold) / Math.max(0.01, 0.85 - spec.buyThreshold);
  return Math.min(spec.maxLeverage, Math.max(0.5, 0.75 + scaled * (spec.maxLeverage - 0.75)));
}

function targetFor(spec: VariantSpec, previousTarget: number, state: DayState) {
  const f = state.features;
  const isUptrend = state.sma200 !== null && state.row.close > state.sma200;
  const macroOk = !spec.macroFilter || (f.macroRiskScore ?? 0) <= 0.5;
  const sentimentOk = !spec.sentimentFilter || (f.fearGreedIndex ?? 50) <= 35;
  const mvrvHot = spec.mvrvTrimThreshold !== null && (f.mvrvPercentile ?? 0) >= spec.mvrvTrimThreshold;

  if (state.isTrim || mvrvHot) return spec.trimTarget;
  if (spec.trendFilter && !isUptrend && previousTarget > 0) return Math.min(previousTarget, 0.75);

  let target = macroOk && sentimentOk ? valueTarget(spec, state) : spec.baseTarget;
  if (target > spec.baseTarget && spec.liquidityBoost > 0) {
    const liquidityOk = (f.stablecoinLiquidityImpulse30dVsAnnual ?? 0) > 0 || (f.macroLiquidityImpulseZ252d ?? 0) > 0.75;
    const fundingOk = (f.futuresFundingRateSumZ90d ?? 0) < 1.25;
    if (liquidityOk && fundingOk) target = Math.min(spec.maxLeverage, target + spec.liquidityBoost);
  }

  if (spec.family === 'stateful-value' || spec.family === 'liquidity-boost') return Math.max(previousTarget, target);
  if (spec.family === 'trend-confirmed') return isUptrend ? Math.max(previousTarget, target) : Math.min(previousTarget, target);
  return target;
}

function tradeToTarget(cash: number, btc: number, price: number, target: number) {
  const equity = cash + btc * price;
  const current = equity > 0 ? btc * price / equity : 0;
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

function run(spec: VariantSpec): VariantResult {
  const states = buildStates();
  let cash = INITIAL_CAPITAL;
  let btc = 0;
  let trades = 0;
  let feesPaid = 0;
  let borrowCost = 0;
  let liquidated = false;
  let previousTarget = spec.baseTarget;
  const values: number[] = [];
  const exposures: number[] = [];

  for (let i = 1; i < states.length; i++) {
    const signal = states[i - 1];
    const row = states[i].row;
    if (cash < 0) {
      const dailyBorrow = -cash * BORROW_APR / 365;
      cash -= dailyBorrow;
      borrowCost += dailyBorrow;
    }

    const openEquity = cash + btc * row.open;
    const lowEquity = cash + btc * row.low;
    const lowMargin = btc > 0 ? lowEquity / (btc * row.low) : Infinity;
    if (openEquity <= 0 || lowEquity <= 0 || lowMargin < MAINTENANCE_MARGIN) {
      cash = 0;
      btc = 0;
      liquidated = true;
      values.push(0);
      exposures.push(0);
      break;
    }

    const target = Math.max(0, Math.min(spec.maxLeverage, targetFor(spec, previousTarget, signal)));
    const trade = tradeToTarget(cash, btc, row.open, target);
    cash = trade.cash;
    btc = trade.btc;
    feesPaid += trade.fee;
    if (trade.traded) trades++;
    previousTarget = target;

    const value = cash + btc * row.close;
    values.push(value);
    exposures.push(value > 0 ? btc * row.close / value : 0);
  }

  const start = states[0].row.open;
  const end = states.at(-1)!.row.close;
  const buyHoldBtc = INITIAL_CAPITAL * (1 - FEE_RATE) / start;
  const buyHoldValues = states.map(state => buyHoldBtc * state.row.close);
  const buyHoldFinalValue = buyHoldBtc * end;
  const finalValue = values.at(-1) ?? 0;
  const periodYears = years(states[0].date, states.at(-1)!.date);

  return {
    spec,
    finalValue,
    totalReturn: finalValue / INITIAL_CAPITAL - 1,
    cagr: finalValue > 0 ? Math.pow(finalValue / INITIAL_CAPITAL, 1 / periodYears) - 1 : -1,
    maxDrawdown: maxDrawdown(values),
    exposure: exposures.reduce((sum, value) => sum + value, 0) / Math.max(1, exposures.length),
    trades,
    feesPaid,
    borrowCost,
    liquidated,
    beatsBuyHold: finalValue > buyHoldFinalValue,
    buyHoldFinalValue,
    buyHoldCagr: Math.pow(buyHoldFinalValue / INITIAL_CAPITAL, 1 / periodYears) - 1,
    buyHoldMaxDrawdown: maxDrawdown(buyHoldValues),
  };
}

function specs(): VariantSpec[] {
  const out: VariantSpec[] = [];
  const families: VariantFamily[] = ['stateful-value', 'trend-confirmed', 'macro-filtered', 'sentiment-contrarian', 'mvrv-trim', 'liquidity-boost'];
  for (const family of families) {
    for (const buyThreshold of [0.68, 0.7, 0.72, 0.75]) {
      for (const maxLeverage of [1, 1.15, 1.25, 1.35, 1.5]) {
        for (const trimTarget of [0, 0.25, 0.5, 0.75]) {
          const spec: VariantSpec = {
            id: `${family}-buy${buyThreshold}-trim${trimTarget}-L${maxLeverage}`,
            family,
            buyThreshold,
            maxLeverage,
            trimTarget,
            baseTarget: 0,
            trendFilter: family === 'trend-confirmed',
            macroFilter: family === 'macro-filtered',
            sentimentFilter: family === 'sentiment-contrarian',
            mvrvTrimThreshold: family === 'mvrv-trim' ? 0.92 : null,
            liquidityBoost: family === 'liquidity-boost' ? 0.15 : 0,
          };
          out.push(spec);
        }
      }
    }
  }
  return out;
}

function fmtPct(value: number, digits = 1) {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function fmtUsd(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function render(results: VariantResult[], generatedAt: string) {
  const sorted = [...results].sort((a, b) => b.finalValue - a.finalValue);
  const safe = sorted.filter(result => result.beatsBuyHold && !result.liquidated && result.maxDrawdown > -0.45);
  const adjusted = [...results]
    .filter(result => !result.liquidated && result.maxDrawdown < 0)
    .sort((a, b) => (b.cagr / Math.abs(b.maxDrawdown)) - (a.cagr / Math.abs(a.maxDrawdown)));
  const baseline = results[0];
  const rowsFor = (items: VariantResult[]) => items.slice(0, 15).map(result =>
    `| \`${result.spec.id}\` | ${fmtUsd(result.finalValue)} | ${fmtPct(result.cagr)} | ${fmtPct(result.maxDrawdown)} | ${fmtPct(result.exposure)} | ${result.trades} | ${result.liquidated ? 'yes' : 'no'} | ${fmtUsd(result.borrowCost)} |`
  ).join('\n');

  return `# BTC trading variant research\n\n` +
    `Generated: ${generatedAt}\n\n` +
    `Buy-and-hold benchmark: ${fmtUsd(baseline.buyHoldFinalValue)} (${fmtPct(baseline.buyHoldCagr)} CAGR, ${fmtPct(baseline.buyHoldMaxDrawdown)} max DD).\n\n` +
    `All variants are causal: prior-day features, scheduled cycle Trim windows, next-day open execution, ${(FEE_RATE * 100).toFixed(2)}% fee, ${(BORROW_APR * 100).toFixed(1)}% borrow APR, intraday low liquidation tripwire.\n\n` +
    `## Safe Candidates That Beat Buy-And-Hold\n\n` +
    `| strategy | final | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${rowsFor(safe)}\n\n` +
    `## Top By Ending Value\n\n` +
    `| strategy | final | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${rowsFor(sorted)}\n\n` +
    `## Top Risk-Adjusted\n\n` +
    `| strategy | final | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${rowsFor(adjusted)}\n`;
}

function main() {
  const generatedAt = new Date().toISOString();
  const results = specs().map(run);
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `trading-variant-research-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `trading-variant-research-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify({ generatedAt, results }, null, 2)}\n`);
  writeFileSync(mdPath, render(results, generatedAt));
  const safe = results.filter(result => result.beatsBuyHold && !result.liquidated && result.maxDrawdown > -0.45).sort((a, b) => b.finalValue - a.finalValue)[0];
  const top = [...results].sort((a, b) => b.finalValue - a.finalValue)[0];
  console.log(`Best safe: ${safe ? `${safe.spec.id} final=${fmtUsd(safe.finalValue)} CAGR=${fmtPct(safe.cagr)} maxDD=${fmtPct(safe.maxDrawdown)}` : 'none'}`);
  console.log(`Best raw: ${top.spec.id} final=${fmtUsd(top.finalValue)} CAGR=${fmtPct(top.cagr)} maxDD=${fmtPct(top.maxDrawdown)} liquidated=${top.liquidated ? 'yes' : 'no'}`);
  console.log(`Report: ${mdPath}`);
}

main();
