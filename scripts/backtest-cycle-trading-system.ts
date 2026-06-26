import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import { computeBuyZonePoints } from '../src/lib/buyZone';
import { addDays, addMonths, ATL_TO_ATH_DAYS, ATH_TO_ATL_DAYS, CYCLE_PIVOTS, PHASE_ZONES, TRIM_BEFORE_ATH_DAYS, type CyclePivot, type PhaseZone } from '../src/lib/cycle';
import type { OHLCVData } from '../src/lib/api';

const INITIAL_CAPITAL = 1000;
const FEE_RATE = 0.001;
const BORROW_APR = 0.08;
const MAINTENANCE_MARGIN = 0.15;
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');

type ZoneMode = 'visible-oracle' | 'scheduled';
type StrategyKind = 'all-in' | 'ladder' | 'risk-scaled' | 'base-hold' | 'stateful-ladder' | 'stateful-risk';

interface StrategySpec {
  id: string;
  zoneMode: ZoneMode;
  kind: StrategyKind;
  buyThreshold: number;
  maxThreshold: number;
  trimTarget: number;
  baseTarget: number;
  maxLeverage: number;
  rebalanceThreshold: number;
}

interface DailyState {
  date: string;
  close: number;
  bottomScore: number | null;
  isTrim: boolean;
}

interface BacktestResult {
  spec: StrategySpec;
  startDate: string;
  endDate: string;
  finalValue: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  exposure: number;
  trades: number;
  turnover: number;
  feesPaid: number;
  borrowCost: number;
  liquidated: boolean;
  bestTradeReturn: number | null;
  worstTradeReturn: number | null;
  avgTradeReturn: number | null;
  winRate: number | null;
  buyHoldFinalValue: number;
  buyHoldReturn: number;
  buyHoldCagr: number;
  buyHoldMaxDrawdown: number;
}

const rows = btcHistory as OHLCVData[];
const rowByDate = new Map(rows.map((row, index) => [row.date, { row, index }]));
const buyPointByDate = new Map(computeBuyZonePoints().map(point => [point.date, point]));

function scheduledPhaseZones(untilYear = 2040): PhaseZone[] {
  const pivots: CyclePivot[] = [{ date: '2015-01-14', type: 'ATL', known: true }];
  let last = pivots[0];
  while (new Date(last.date + 'T00:00:00Z').getUTCFullYear() < untilYear) {
    const nextDays = last.type === 'ATL' ? ATL_TO_ATH_DAYS : ATH_TO_ATL_DAYS;
    const nextType = last.type === 'ATL' ? 'ATH' as const : 'ATL' as const;
    const pivot = { date: addDays(last.date, nextDays), type: nextType, known: false };
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

function isInTrim(date: string, zones: PhaseZone[]): boolean {
  return zones.some(zone => zone.label === 'Trim' && zone.startDate <= date && date < zone.endDate);
}

function entryTarget(spec: StrategySpec, state: DailyState): number {
  const score = state.bottomScore;
  if (score === null || score < spec.buyThreshold) return spec.baseTarget;

  if (spec.kind === 'all-in') return 1;
  if (spec.kind === 'base-hold') return Math.max(spec.baseTarget, score >= spec.buyThreshold ? 0.65 : spec.baseTarget);
  if (spec.kind === 'ladder' || spec.kind === 'stateful-ladder') {
    if (score >= spec.maxThreshold) return spec.maxLeverage;
    if (score >= spec.buyThreshold + 0.05) return Math.min(spec.maxLeverage, spec.maxLeverage >= 1.25 ? 1.25 : 0.75);
    return 0.5;
  }

  const scaled = (score - spec.buyThreshold) / Math.max(0.01, spec.maxThreshold - spec.buyThreshold);
  return Math.max(spec.baseTarget, Math.min(spec.maxLeverage, scaled * spec.maxLeverage));
}

function targetAllocation(spec: StrategySpec, state: DailyState, previousTarget: number): number {
  if (state.isTrim) return spec.trimTarget;
  if (spec.kind === 'stateful-ladder' || spec.kind === 'stateful-risk') {
    return Math.max(spec.baseTarget, previousTarget, entryTarget(spec, state));
  }
  return entryTarget(spec, state);
}

function resetsAfterTrim(spec: StrategySpec, previousState: DailyState, state: DailyState): boolean {
  return previousState.isTrim && !state.isTrim && (spec.kind === 'stateful-ladder' || spec.kind === 'stateful-risk');
}

function resetTarget(spec: StrategySpec): number {
  return spec.baseTarget;
}

function isStateful(spec: StrategySpec): boolean {
  return spec.kind === 'stateful-ladder' || spec.kind === 'stateful-risk';
}

function seededTarget(spec: StrategySpec): number {
  return isStateful(spec) ? spec.baseTarget : 0;
}

function assertFiniteTarget(target: number): number {
  return Math.max(0, Number.isFinite(target) ? target : 0);
}

function targetFromSignal(spec: StrategySpec, previousState: DailyState | null, state: DailyState, previousTarget: number): number {
  if (previousState && resetsAfterTrim(spec, previousState, state)) return resetTarget(spec);
  return Math.min(spec.maxLeverage, assertFiniteTarget(targetAllocation(spec, state, previousTarget)));
}

function yearsBetween(startDate: string, endDate: string): number {
  return Math.max(1 / 365, (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (365.25 * 86400000));
}

function maxDrawdown(values: number[]): number {
  let peak = values[0] ?? 0;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

function tradeToTarget(cash: number, btc: number, price: number, target: number) {
  const value = cash + btc * price;
  const current = value > 0 ? (btc * price) / value : 0;
  const delta = target - current;
  if (Math.abs(delta) < 1e-9) return { cash, btc, fee: 0, turnover: 0, traded: false };

  if (delta > 0) {
    const spend = Math.max(0, value * delta);
    const fee = spend * FEE_RATE;
    return {
      cash: cash - spend - fee,
      btc: btc + spend / price,
      fee,
      turnover: spend,
      traded: spend > 0,
    };
  }

  const grossSell = Math.min(btc * price, value * -delta);
  const fee = grossSell * FEE_RATE;
  return {
    cash: cash + grossSell - fee,
    btc: btc - grossSell / price,
    fee,
    turnover: grossSell,
    traded: grossSell > 0,
  };
}

function runBacktest(spec: StrategySpec): BacktestResult {
  const zones = spec.zoneMode === 'visible-oracle' ? PHASE_ZONES : scheduledPhaseZones();
  const startDate = '2015-01-14';
  const startIndex = rowByDate.get(startDate)?.index ?? 0;
  const testRows = rows.slice(startIndex);
  const states = testRows.map(row => ({
    date: row.date,
    close: row.close,
    bottomScore: buyPointByDate.get(row.date)?.bottomScore ?? null,
    isTrim: isInTrim(row.date, zones),
  }));

  let cash = INITIAL_CAPITAL;
  let btc = 0;
  let trades = 0;
  let feesPaid = 0;
  let turnover = 0;
  let borrowCost = 0;
  let liquidated = false;
  const values: number[] = [];
  const exposures: number[] = [];
  const tradeEntries: number[] = [];
  const tradeReturns: number[] = [];
  let previousTarget = seededTarget(spec);

  for (let i = 1; i < testRows.length; i++) {
    const signal = states[i - 1];
    const previousSignal = i >= 2 ? states[i - 2] : null;
    const row = testRows[i];

    if (cash < 0) {
      const dailyBorrow = -cash * BORROW_APR / 365;
      cash -= dailyBorrow;
      borrowCost += dailyBorrow;
    }

    const price = row.open > 0 ? row.open : row.close;
    const beforeValue = cash + btc * price;
    if (beforeValue <= 0) {
      cash = 0;
      btc = 0;
      liquidated = true;
      values.push(0);
      exposures.push(0);
      break;
    }

    const marginRatio = btc > 0 ? beforeValue / (btc * price) : Infinity;
    if (marginRatio < MAINTENANCE_MARGIN) {
      cash = 0;
      btc = 0;
      liquidated = true;
      values.push(0);
      exposures.push(0);
      break;
    }

    const target = targetFromSignal(spec, previousSignal, signal, previousTarget);
    const currentTarget = beforeValue > 0 ? (btc * price) / beforeValue : 0;

    if (Math.abs(target - currentTarget) >= spec.rebalanceThreshold) {
      const hadBtc = btc > 1e-12;
      const trade = tradeToTarget(cash, btc, price, target);
      cash = trade.cash;
      btc = trade.btc;
      feesPaid += trade.fee;
      turnover += trade.turnover;
      if (trade.traded) trades++;

      if (!hadBtc && btc > 1e-12) tradeEntries.push(price);
      if (hadBtc && btc <= 1e-12) {
        const entry = tradeEntries.pop();
        if (entry) tradeReturns.push(price / entry - 1);
      }
    }
    previousTarget = target;

    const endValue = cash + btc * row.close;
    values.push(endValue);
    exposures.push(endValue > 0 ? (btc * row.close) / endValue : 0);
  }

  const finalValue = values.at(-1) ?? INITIAL_CAPITAL;
  const years = yearsBetween(testRows[0].date, testRows.at(-1)!.date);
  const buyHoldBtc = INITIAL_CAPITAL * (1 - FEE_RATE) / testRows[0].open;
  const buyHoldValues = testRows.map(row => buyHoldBtc * row.close);
  const buyHoldFinalValue = buyHoldValues.at(-1) ?? INITIAL_CAPITAL;
  const exposure = exposures.reduce((sum, value) => sum + value, 0) / Math.max(1, exposures.length);

  return {
    spec,
    startDate: testRows[0].date,
    endDate: testRows.at(-1)!.date,
    finalValue,
    totalReturn: finalValue / INITIAL_CAPITAL - 1,
    cagr: Math.pow(finalValue / INITIAL_CAPITAL, 1 / years) - 1,
    maxDrawdown: maxDrawdown(values),
    exposure,
    trades,
    turnover,
    feesPaid,
    borrowCost,
    liquidated,
    bestTradeReturn: tradeReturns.length ? Math.max(...tradeReturns) : null,
    worstTradeReturn: tradeReturns.length ? Math.min(...tradeReturns) : null,
    avgTradeReturn: tradeReturns.length ? tradeReturns.reduce((sum, value) => sum + value, 0) / tradeReturns.length : null,
    winRate: tradeReturns.length ? tradeReturns.filter(value => value > 0).length / tradeReturns.length : null,
    buyHoldFinalValue,
    buyHoldReturn: buyHoldFinalValue / INITIAL_CAPITAL - 1,
    buyHoldCagr: Math.pow(buyHoldFinalValue / INITIAL_CAPITAL, 1 / years) - 1,
    buyHoldMaxDrawdown: maxDrawdown(buyHoldValues),
  };
}

function specs(): StrategySpec[] {
  const output: StrategySpec[] = [];
  for (const zoneMode of ['scheduled', 'visible-oracle'] as ZoneMode[]) {
    for (const kind of ['all-in', 'ladder', 'risk-scaled', 'base-hold', 'stateful-ladder', 'stateful-risk'] as StrategyKind[]) {
      for (const buyThreshold of [0.65, 0.70, 0.75]) {
        for (const trimTarget of [0, 0.15, 0.3, 0.5]) {
          for (const maxLeverage of [1, 1.25, 1.5, 2]) {
            if (maxLeverage > 1 && (kind === 'base-hold' || kind === 'all-in')) continue;
          const baseTargets = kind === 'base-hold' ? [0.2, 0.35] : [0];
          for (const baseTarget of baseTargets) {
            output.push({
              id: `${zoneMode}-${kind}-buy${buyThreshold}-trim${trimTarget}-base${baseTarget}-L${maxLeverage}`,
              zoneMode,
              kind,
              buyThreshold,
              maxThreshold: Math.max(0.8, buyThreshold + 0.1),
              trimTarget,
              baseTarget,
              maxLeverage,
              rebalanceThreshold: 0.1,
            });
          }
          }
        }
      }
    }
  }
  return output;
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function fmtUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function renderMarkdown(results: BacktestResult[], generatedAt: string): string {
  const sorted = [...results].sort((a, b) => b.finalValue - a.finalValue);
  const causal = sorted.filter(result => result.spec.zoneMode === 'scheduled');
  const oracle = sorted.filter(result => result.spec.zoneMode === 'visible-oracle');
  const riskAdjusted = [...results]
    .filter(result => result.spec.zoneMode === 'scheduled' && !result.liquidated && result.maxDrawdown < 0)
    .sort((a, b) => (b.cagr / Math.abs(b.maxDrawdown)) - (a.cagr / Math.abs(a.maxDrawdown)));
  const baseline = sorted[0];
  const topRows = (items: BacktestResult[]) => items.slice(0, 12).map(result =>
    `| \`${result.spec.id}\` | ${fmtUsd(result.finalValue)} | ${fmtPct(result.totalReturn, 0)} | ${fmtPct(result.cagr)} | ${fmtPct(result.maxDrawdown)} | ${fmtPct(result.exposure)} | ${result.trades} | ${result.liquidated ? 'yes' : 'no'} | ${fmtUsd(result.borrowCost)} |`
  ).join('\n');
  const riskRows = riskAdjusted.slice(0, 12).map(result =>
    `| \`${result.spec.id}\` | ${fmtUsd(result.finalValue)} | ${fmtPct(result.cagr)} | ${fmtPct(result.maxDrawdown)} | ${(result.cagr / Math.abs(result.maxDrawdown)).toFixed(2)} | ${fmtPct(result.exposure)} | ${fmtUsd(result.borrowCost)} |`
  ).join('\n');

  return `# BTC cycle-zone trading-system sweep\n\n` +
    `Generated: ${generatedAt}\n\n` +
    `Initial capital: ${fmtUsd(INITIAL_CAPITAL)}. Fee assumption: ${(FEE_RATE * 100).toFixed(2)}% per trade. Borrow APR for leveraged variants: ${(BORROW_APR * 100).toFixed(1)}%. Maintenance margin tripwire: ${(MAINTENANCE_MARGIN * 100).toFixed(0)}%. Trades execute on next-day open after a prior-day signal.\n\n` +
    `## Important leakage note\n\n` +
    `The visible chart's orange Trim zone is the 30 days before an ATH marker. Historical known ATH/ATL markers are not tradable if they were identified after the fact, so \`visible-oracle\` is reported only as an upper-bound/reference. The \`scheduled\` variant uses the fixed 1064d ATL→ATH and 364d ATH→ATL cadence seeded from the 2015-01-14 ATL.\n\n` +
    `Buy signal uses the existing leakage-safe heavy-buy score. Trim signal uses the main-chart Trim band.\n\n` +
    `Buy-and-hold from ${baseline.startDate} to ${baseline.endDate}: ${fmtUsd(baseline.buyHoldFinalValue)} (${fmtPct(baseline.buyHoldReturn, 0)} total, ${fmtPct(baseline.buyHoldCagr)} CAGR, ${fmtPct(baseline.buyHoldMaxDrawdown)} max DD).\n\n` +
    `## Best causal scheduled systems\n\n` +
    `| strategy | final | return | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${topRows(causal)}\n\n` +
    `## Best Risk-Adjusted Causal Systems\n\n` +
    `Score is CAGR divided by absolute max drawdown; this favors systems that survive cleanly.\n\n` +
    `| strategy | final | CAGR | max DD | score | avg exposure | borrow cost |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${riskRows}\n\n` +
    `## Visible/oracle reference\n\n` +
    `| strategy | final | return | CAGR | max DD | avg exposure | trades | liquidated | borrow cost |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${topRows(oracle)}\n\n` +
    `## Proposed robust rule\n\n` +
    `Prefer scheduled, stateful ladder/risk-scaled systems over all-in systems unless the goal is pure upside. A robust live rule should accumulate in steps when bottomScore crosses 0.70/0.75, use no more than modest leverage unless fresh walk-forward tests justify it, and trim to 15-30% BTC exposure in scheduled Trim windows instead of going fully flat.\n`;
}

function main(): void {
  const generatedAt = new Date().toISOString();
  const results = specs().map(runBacktest);
  const stamp = generatedAt.replace(/[:.]/g, '-');
  mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = join(REPORT_DIR, `cycle-trading-system-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `cycle-trading-system-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify({ generatedAt, initialCapital: INITIAL_CAPITAL, feeRate: FEE_RATE, knownPivots: CYCLE_PIVOTS, results }, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(results, generatedAt));

  const topScheduled = results.filter(result => result.spec.zoneMode === 'scheduled').sort((a, b) => b.finalValue - a.finalValue)[0];
  const topOracle = results.filter(result => result.spec.zoneMode === 'visible-oracle').sort((a, b) => b.finalValue - a.finalValue)[0];
  console.log(`Top scheduled: ${topScheduled.spec.id} final=${fmtUsd(topScheduled.finalValue)} CAGR=${fmtPct(topScheduled.cagr)} maxDD=${fmtPct(topScheduled.maxDrawdown)}`);
  console.log(`Top visible/oracle: ${topOracle.spec.id} final=${fmtUsd(topOracle.finalValue)} CAGR=${fmtPct(topOracle.cagr)} maxDD=${fmtPct(topOracle.maxDrawdown)}`);
  console.log(`Report: ${mdPath}`);
}

main();
