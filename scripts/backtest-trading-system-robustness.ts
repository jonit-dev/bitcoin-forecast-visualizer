import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import { computeBuyZonePoints } from '../src/lib/buyZone';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';

const INITIAL_CAPITAL = 1000;
const BASE_FEE_RATE = 0.001;
const BORROW_APR = 0.08;
const MAINTENANCE_MARGIN = 0.15;
const START_DATE = '2015-01-14';
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');

interface StrategySpec {
  id: string;
  trendFastDays: number;
  trendSlowDays: number;
  valueThreshold: number;
  valueStrongThreshold: number;
  hotConfirmDays: number;
  coolConfirmDays: number;
  breakConfirmDays: number;
  reentryCooldownDays: number;
  trimTarget: number;
  maxTarget: number;
}

interface BacktestOptions {
  feeRate: number;
  slippageRate: number;
  startDate: string;
  endDate?: string;
}

interface BacktestResult {
  spec: StrategySpec;
  startDate: string;
  endDate: string;
  finalValue: number;
  buyHoldFinalValue: number;
  cagr: number;
  buyHoldCagr: number;
  maxDrawdown: number;
  buyHoldMaxDrawdown: number;
  calmar: number;
  buyHoldCalmar: number;
  dailySharpe: number;
  buyHoldDailySharpe: number;
  averageExposure: number;
  trades: number;
  markers: number;
  feesPaid: number;
  borrowCost: number;
  liquidated: boolean;
}

interface RobustnessRow {
  spec: StrategySpec;
  full: BacktestResult;
  feeStress: BacktestResult;
  splits: BacktestResult[];
  splitBeatRate: number;
  splitLowerDdRate: number;
  score: number;
}

const rows = btcHistory as OHLCVData[];
const rowIndexByDate = new Map(rows.map((row, index) => [row.date, index]));
const featuresByDate = new Map((featureTable as FeatureRow[]).map(row => [row.date, row.features]));
const buyPointByDate = new Map(computeBuyZonePoints().map(point => [point.date, point]));

const COMMITTED_SPEC: StrategySpec = {
  id: 'confirmed-trend-value-hot14-cool45-break10-reentry30-trim35',
  trendFastDays: 100,
  trendSlowDays: 150,
  valueThreshold: 0.65,
  valueStrongThreshold: 0.70,
  hotConfirmDays: 14,
  coolConfirmDays: 45,
  breakConfirmDays: 10,
  reentryCooldownDays: 30,
  trimTarget: 0.35,
  maxTarget: 1,
};

const SPLITS = [
  { label: '2015-2018', startDate: '2015-01-14', endDate: '2018-12-31' },
  { label: '2019-2022', startDate: '2019-01-01', endDate: '2022-12-31' },
  { label: '2023-latest', startDate: '2023-01-01' },
];

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

function dailySharpe(values: number[]): number {
  if (values.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1];
    if (previous > 0) returns.push(values[i] / previous - 1);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? (mean / std) * Math.sqrt(365) : 0;
}

function maxDrawdown(values: number[]): number {
  let peak = values[0] ?? INITIAL_CAPITAL;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

function signalState(spec: StrategySpec, date: string, rowIndex: number) {
  const score = buyPointByDate.get(date)?.bottomScore ?? null;
  const features = featuresByDate.get(date) ?? {};
  const fast = movingAverage(rowIndex, spec.trendFastDays);
  const slow = movingAverage(rowIndex, spec.trendSlowDays);
  const close = rows[rowIndex].close;
  const trendConfirmed = fast !== null && slow !== null && close > slow && fast > slow;
  const trendBroken = slow !== null && close < slow;
  const valueConfirmed = score !== null && score >= spec.valueThreshold;
  const valueStillStrong = score !== null && score >= spec.valueStrongThreshold;
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
  spec: StrategySpec,
  previousTarget: number,
  signal: ReturnType<typeof signalState>,
  hotDays: number,
  coolDays: number,
  breakDays: number,
  flatDays: number,
): number {
  const riskOn = signal.trendConfirmed || signal.valueConfirmed;
  if (previousTarget === 0) {
    return flatDays >= spec.reentryCooldownDays && riskOn && breakDays === 0 ? spec.maxTarget : 0;
  }

  let target = previousTarget;
  if (hotDays >= spec.hotConfirmDays && target > spec.trimTarget) target = spec.trimTarget;
  if (target === spec.trimTarget && coolDays >= spec.coolConfirmDays && riskOn) target = spec.maxTarget;
  if (breakDays >= spec.breakConfirmDays) target = 0;
  return target;
}

function tradeToTarget(cash: number, btc: number, price: number, target: number, options: BacktestOptions) {
  const equity = cash + btc * price;
  const current = equity > 0 ? (btc * price) / equity : 0;
  const delta = target - current;
  if (Math.abs(delta) < 0.1) return { cash, btc, fee: 0, traded: false };

  if (delta > 0) {
    const executionPrice = price * (1 + options.slippageRate);
    const notional = Math.min(equity * delta, cash / (1 + options.feeRate));
    const fee = notional * options.feeRate;
    return { cash: cash - notional - fee, btc: btc + notional / executionPrice, fee, traded: true };
  }

  const executionPrice = price * (1 - options.slippageRate);
  const notional = Math.min(btc * executionPrice, equity * -delta);
  const fee = notional * options.feeRate;
  return { cash: cash + notional - fee, btc: btc - notional / executionPrice, fee, traded: true };
}

function runBacktest(spec: StrategySpec, options: BacktestOptions): BacktestResult {
  const testRows = rows.filter(row => row.date >= options.startDate && (!options.endDate || row.date <= options.endDate));
  if (testRows.length < 3) throw new Error(`Not enough rows for ${options.startDate} -> ${options.endDate ?? 'latest'}`);

  let cash = INITIAL_CAPITAL;
  let btc = 0;
  let target = 0;
  let trades = 0;
  let feesPaid = 0;
  let borrowCost = 0;
  let liquidated = false;
  let exposureSum = 0;
  let markers = 0;
  let lastMarkerTargetPct: number | null = null;
  let hotDays = 0;
  let coolDays = 0;
  let breakDays = 0;
  let flatDays = 999;
  const values: number[] = [INITIAL_CAPITAL];
  const buyHoldValues: number[] = [INITIAL_CAPITAL];

  const buyHoldBtc = INITIAL_CAPITAL * (1 - options.feeRate) / (testRows[0].open * (1 + options.slippageRate));

  for (let i = 1; i < testRows.length; i++) {
    const signal = testRows[i - 1];
    const row = testRows[i];
    const signalIndex = rowIndexByDate.get(signal.date);
    if (signalIndex === undefined) throw new Error(`Missing row index for ${signal.date}`);

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
      values.push(0);
      break;
    }

    const signalFlags = signalState(spec, signal.date, signalIndex);
    hotDays = signalFlags.valuationHot ? hotDays + 1 : 0;
    coolDays = signalFlags.valuationHot ? 0 : coolDays + 1;
    breakDays = signalFlags.trendBroken ? breakDays + 1 : 0;

    const nextTarget = targetExposure(spec, target, signalFlags, hotDays, coolDays, breakDays, flatDays);
    const trade = tradeToTarget(cash, btc, row.open, nextTarget, options);
    if (trade.traded) {
      cash = trade.cash;
      btc = trade.btc;
      feesPaid += trade.fee;
      trades++;
      const markerTargetPct = Math.round(nextTarget * 100);
      if (markerTargetPct !== lastMarkerTargetPct) {
        markers++;
        lastMarkerTargetPct = markerTargetPct;
      }
    }

    target = nextTarget;
    if (target === 0) flatDays++;
    else flatDays = 0;

    const value = cash + btc * row.close;
    values.push(value);
    exposureSum += value > 0 ? (btc * row.close) / value : 0;
    buyHoldValues.push(buyHoldBtc * row.close);
  }

  const finalValue = values.at(-1) ?? INITIAL_CAPITAL;
  const buyHoldFinalValue = buyHoldValues.at(-1) ?? INITIAL_CAPITAL;
  const actualEndDate = testRows[Math.min(testRows.length - 1, values.length - 1)].date;
  const periodYears = yearsBetween(testRows[0].date, actualEndDate);
  const systemCagr = cagr(finalValue, periodYears);
  const holdCagr = cagr(buyHoldFinalValue, periodYears);
  const systemDrawdown = maxDrawdown(values);
  const holdDrawdown = maxDrawdown(buyHoldValues);

  return {
    spec,
    startDate: testRows[0].date,
    endDate: actualEndDate,
    finalValue,
    buyHoldFinalValue,
    cagr: systemCagr,
    buyHoldCagr: holdCagr,
    maxDrawdown: systemDrawdown,
    buyHoldMaxDrawdown: holdDrawdown,
    calmar: systemDrawdown < 0 ? systemCagr / Math.abs(systemDrawdown) : 0,
    buyHoldCalmar: holdDrawdown < 0 ? holdCagr / Math.abs(holdDrawdown) : 0,
    dailySharpe: dailySharpe(values),
    buyHoldDailySharpe: dailySharpe(buyHoldValues),
    averageExposure: exposureSum / Math.max(1, values.length - 1),
    trades,
    markers,
    feesPaid,
    borrowCost,
    liquidated,
  };
}

function specs(): StrategySpec[] {
  const out: StrategySpec[] = [COMMITTED_SPEC];
  for (const trendFastDays of [50, 100, 150]) {
    for (const trendSlowDays of [150, 200]) {
      if (trendFastDays >= trendSlowDays) continue;
      for (const valueThreshold of [0.60, 0.65, 0.70]) {
        for (const hotConfirmDays of [7, 14, 21, 30]) {
          for (const coolConfirmDays of [30, 45, 60]) {
            for (const breakConfirmDays of [5, 10, 20]) {
              for (const reentryCooldownDays of [10, 30, 60]) {
                for (const trimTarget of [0.35, 0.5, 0.65]) {
                  out.push({
                    id: `tv-f${trendFastDays}-s${trendSlowDays}-v${valueThreshold}-hot${hotConfirmDays}-cool${coolConfirmDays}-break${breakConfirmDays}-re${reentryCooldownDays}-trim${trimTarget}`,
                    trendFastDays,
                    trendSlowDays,
                    valueThreshold,
                    valueStrongThreshold: Math.min(0.80, valueThreshold + 0.05),
                    hotConfirmDays,
                    coolConfirmDays,
                    breakConfirmDays,
                    reentryCooldownDays,
                    trimTarget,
                    maxTarget: 1,
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  return out;
}

function score(row: RobustnessRow): number {
  if (row.full.liquidated || row.feeStress.liquidated) return -Infinity;
  if (row.full.borrowCost > 1 || row.feeStress.borrowCost > 1) return -Infinity;
  if (row.full.finalValue <= row.full.buyHoldFinalValue) return -Infinity;
  if (row.full.maxDrawdown <= row.full.buyHoldMaxDrawdown) return -Infinity;

  const fullReturnEdge = Math.log(row.full.finalValue / row.full.buyHoldFinalValue);
  const feeStressEdge = Math.log(row.feeStress.finalValue / row.feeStress.buyHoldFinalValue);
  const ddImprovement = Math.abs(row.full.buyHoldMaxDrawdown) - Math.abs(row.full.maxDrawdown);
  const splitQuality = row.splitBeatRate + row.splitLowerDdRate;
  const tradePenalty = Math.max(0, row.full.trades - 40) / 100;
  return fullReturnEdge + feeStressEdge + ddImprovement + splitQuality - tradePenalty;
}

function evaluate(spec: StrategySpec): RobustnessRow {
  const full = runBacktest(spec, { feeRate: BASE_FEE_RATE, slippageRate: 0, startDate: START_DATE });
  const feeStress = runBacktest(spec, { feeRate: BASE_FEE_RATE * 2, slippageRate: 0.0005, startDate: START_DATE });
  const splits = SPLITS.map(split => runBacktest(spec, { feeRate: BASE_FEE_RATE, slippageRate: 0, startDate: split.startDate, endDate: split.endDate }));
  const splitBeatRate = splits.filter(split => split.finalValue > split.buyHoldFinalValue).length / splits.length;
  const splitLowerDdRate = splits.filter(split => Math.abs(split.maxDrawdown) < Math.abs(split.buyHoldMaxDrawdown)).length / splits.length;
  const row: RobustnessRow = {
    spec,
    full,
    feeStress,
    splits,
    splitBeatRate,
    splitLowerDdRate,
    score: 0,
  };
  row.score = score(row);
  return row;
}

function fmtPct(value: number, digits = 1): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function fmtUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function resultCells(result: BacktestResult): string {
  return `${fmtUsd(result.finalValue)} | ${fmtPct(result.cagr)} | ${fmtPct(result.maxDrawdown)} | ${result.trades} | ${fmtUsd(result.borrowCost)}`;
}

function render(rows: RobustnessRow[], generatedAt: string): string {
  const ranked = [...rows].sort((a, b) => b.score - a.score);
  const committed = rows.find(row => row.spec.id === COMMITTED_SPEC.id) ?? evaluate(COMMITTED_SPEC);
  const winner = ranked[0];

  const topRows = ranked.slice(0, 20).map((row, index) =>
    `| ${index + 1} | \`${row.spec.id}\` | ${row.score.toFixed(2)} | ${resultCells(row.full)} | ${resultCells(row.feeStress)} | ${fmtPct(row.splitBeatRate, 0)} / ${fmtPct(row.splitLowerDdRate, 0)} |`
  ).join('\n');

  const splitRows = (row: RobustnessRow) => row.splits.map((split, index) =>
    `| ${SPLITS[index].label} | ${resultCells(split)} | ${fmtUsd(split.buyHoldFinalValue)} | ${fmtPct(split.buyHoldCagr)} | ${fmtPct(split.buyHoldMaxDrawdown)} |`
  ).join('\n');

  return `# BTC trading-system robustness report\n\n` +
    `Generated: ${generatedAt}\n\n` +
    `Benchmark is buy-and-hold from the same start/end dates, starting with ${fmtUsd(INITIAL_CAPITAL)}. All strategy runs use prior-day signals, next-day open execution, ${(BASE_FEE_RATE * 100).toFixed(2)}% base fee, and no leverage above 100% BTC.\n\n` +
    `## Current Committed System\n\n` +
    `Spec: \`${COMMITTED_SPEC.id}\`\n\n` +
    `- Full run: ${resultCells(committed.full)} vs buy-and-hold ${fmtUsd(committed.full.buyHoldFinalValue)} / ${fmtPct(committed.full.buyHoldCagr)} / ${fmtPct(committed.full.buyHoldMaxDrawdown)}\n` +
    `- Fee stress: ${resultCells(committed.feeStress)} vs buy-and-hold ${fmtUsd(committed.feeStress.buyHoldFinalValue)} / ${fmtPct(committed.feeStress.buyHoldCagr)} / ${fmtPct(committed.feeStress.buyHoldMaxDrawdown)}\n` +
    `- Split beat / lower-DD rate: ${fmtPct(committed.splitBeatRate, 0)} / ${fmtPct(committed.splitLowerDdRate, 0)}\n\n` +
    `## Best Robust Candidate\n\n` +
    `Spec: \`${winner.spec.id}\`\n\n` +
    `- Full run: ${resultCells(winner.full)} vs buy-and-hold ${fmtUsd(winner.full.buyHoldFinalValue)} / ${fmtPct(winner.full.buyHoldCagr)} / ${fmtPct(winner.full.buyHoldMaxDrawdown)}\n` +
    `- Fee stress: ${resultCells(winner.feeStress)} vs buy-and-hold ${fmtUsd(winner.feeStress.buyHoldFinalValue)} / ${fmtPct(winner.feeStress.buyHoldCagr)} / ${fmtPct(winner.feeStress.buyHoldMaxDrawdown)}\n` +
    `- Split beat / lower-DD rate: ${fmtPct(winner.splitBeatRate, 0)} / ${fmtPct(winner.splitLowerDdRate, 0)}\n\n` +
    `## Top Robust Candidates\n\n` +
    `| rank | strategy | score | full final | full CAGR | full DD | trades | borrow | stress final | stress CAGR | stress DD | stress trades | stress borrow | split beat / lower DD |\n` +
    `| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${topRows}\n\n` +
    `## Best Candidate Splits\n\n` +
    `| period | system final | system CAGR | system DD | trades | borrow | B&H final | B&H CAGR | B&H DD |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${splitRows(winner)}\n\n` +
    `## Current System Splits\n\n` +
    `| period | system final | system CAGR | system DD | trades | borrow | B&H final | B&H CAGR | B&H DD |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `${splitRows(committed)}\n\n` +
    `Interpretation: full-period results are not enough. Prefer candidates that keep the fee-stressed edge and beat buy-and-hold in most period splits while using 0 borrow cost.\n`;
}

function main() {
  const generatedAt = new Date().toISOString();
  const results = specs().map(evaluate).filter(row => Number.isFinite(row.score));
  results.sort((a, b) => b.score - a.score);
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `trading-system-robustness-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `trading-system-robustness-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify({ generatedAt, committedSpec: COMMITTED_SPEC, results }, null, 2)}\n`);
  writeFileSync(mdPath, render(results, generatedAt));
  const winner = results[0];
  console.log(`Best robust: ${winner.spec.id}`);
  console.log(`Full: final=${fmtUsd(winner.full.finalValue)} CAGR=${fmtPct(winner.full.cagr)} DD=${fmtPct(winner.full.maxDrawdown)} trades=${winner.full.trades}`);
  console.log(`Stress: final=${fmtUsd(winner.feeStress.finalValue)} CAGR=${fmtPct(winner.feeStress.cagr)} DD=${fmtPct(winner.feeStress.maxDrawdown)} trades=${winner.feeStress.trades}`);
  console.log(`Report: ${mdPath}`);
}

main();
