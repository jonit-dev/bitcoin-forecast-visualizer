import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import btcHistory from '../src/data/btc-history.json';
import mvrvHistory from '../src/data/mvrv-history.json';
import onchainHistory from '../src/data/onchain-history.json';
import derivativesHistory from '../src/data/derivatives-history.json';
import stablecoinHistory from '../src/data/stablecoin-history.json';
import sentimentHistory from '../src/data/sentiment-history.json';
import cotHistory from '../src/data/cot-history.json';
import macroHistory from '../src/data/macro-history.json';
import etfFlowHistory from '../src/data/etf-flow-history.json';
import type { OHLCVData, MVRVPoint } from '../src/lib/api';
import { basePowerLawPrice, daysSinceGenesis } from '../src/lib/powerLaw';
import { ONCHAIN_FORWARD_FILL_CAP_DAYS, SOURCE_FRESHNESS_CAP_DAYS } from './lib/sourceFreshness.mjs';

const OUT_PATH = join(process.cwd(), 'src/data/feature-table.json');
const MS_PER_DAY = 86400000;

interface FeatureRow {
  date: string;
  features: Record<string, number>;
  sourceDates: Record<string, string>;
  missingFeatureReasons: Record<string, string>;
}

interface SourceLookup {
  row: any | null;
  reason: string | null;
}

function main(): void {
  const btcRows = btcHistory as OHLCVData[];
  const mvrvRows = mvrvHistory as MVRVPoint[];
  const onchainRows = onchainHistory as any[];
  const derivativesRows = (derivativesHistory as any).rows ?? [];
  const stablecoinRows = (stablecoinHistory as any).rows ?? [];
  const sentimentRows = (sentimentHistory as any).rows ?? [];
  const cotRows = (cotHistory as any).rows ?? [];
  const macroRows = (macroHistory as any).rows ?? [];
  const etfRows = (etfFlowHistory as any).rows ?? [];
  const btcByDate = new Map(btcRows.map(row => [row.date, row]));
  const mvrvByDate = new Map(mvrvRows.map(row => [row.date, row]));
  const onchainByDate = new Map(onchainRows.map(row => [row.date, row]));
  const derivativesByDate = new Map(derivativesRows.map((row: any) => [row.date, row]));
  const stablecoinByDate = new Map(stablecoinRows.map((row: any) => [row.date, row]));
  const sentimentByDate = new Map(sentimentRows.map((row: any) => [row.date, row]));
  const rows: FeatureRow[] = [];
  const runningMvrvValues: number[] = [];
  const seenMvrvSourceDates = new Set<string>();

  for (let index = 1; index < btcRows.length; index++) {
    const rowDate = btcRows[index].date;
    const sourceDate = addUtcDays(rowDate, -1);
    const btc = btcByDate.get(sourceDate);
    if (!btc) continue;

    const mvrvLookup = latestSourceRow(mvrvRows, sourceDate, rowDate, ONCHAIN_FORWARD_FILL_CAP_DAYS, 'MVRV');
    const onchainLookup = latestSourceRow(onchainRows, sourceDate, rowDate, ONCHAIN_FORWARD_FILL_CAP_DAYS, 'on-chain');
    const mvrv = mvrvLookup.row;
    if (Number.isFinite(mvrv?.mvrv) && !seenMvrvSourceDates.has(mvrv.date)) {
      runningMvrvValues.push(mvrv.mvrv);
      seenMvrvSourceDates.add(mvrv.date);
    }

    const onchain = onchainLookup.row;
    const derivatives = derivativesByDate.get(sourceDate) as any;
    const stablecoin = stablecoinByDate.get(sourceDate) as any;
    const sentiment = sentimentByDate.get(sourceDate) as any;
    const cotLookup = latestTimedRow(cotRows, sourceDate, rowDate, SOURCE_FRESHNESS_CAP_DAYS.cot, 'COT');
    const macroLookup = latestTimedRow(macroRows, sourceDate, rowDate, SOURCE_FRESHNESS_CAP_DAYS.macro, 'macro');
    const etfLookup = latestTimedRow(etfRows, sourceDate, rowDate, SOURCE_FRESHNESS_CAP_DAYS.etf, 'ETF');
    const cot = cotLookup.row as any;
    const macro = macroLookup.row as any;
    const etf = etfLookup.row as any;
    const features: Record<string, number> = {};
    const sourceDates: Record<string, string> = {};
    const missingFeatureReasons: Record<string, string> = {};
    const setFeature = (name: string, value: number | null | undefined, featureSourceDate = sourceDate, missingReason = 'source value unavailable') => {
      if (Number.isFinite(value)) {
        features[name] = Number(value);
        sourceDates[name] = featureSourceDate;
      } else {
        missingFeatureReasons[name] = missingReason;
      }
    };

    const t = daysSinceGenesis(new Date(`${sourceDate}T00:00:00Z`));
    setFeature('priceResidualLog', Math.log(btc.close / basePowerLawPrice(t)));
    for (const lookback of [7, 30, 90]) {
      const prior = btcByDate.get(addUtcDays(sourceDate, -lookback));
      if (!prior) {
        missingFeatureReasons[`residualMomentum${lookback}d`] = `missing ${lookback}d prior BTC row`;
        continue;
      }
      const priorT = daysSinceGenesis(new Date(`${prior.date}T00:00:00Z`));
      setFeature(`residualMomentum${lookback}d`, Math.log(btc.close / basePowerLawPrice(t)) - Math.log(prior.close / basePowerLawPrice(priorT)));
    }

    const mvrvSourceDate = mvrv?.date ?? sourceDate;
    const mvrvMissingReason = mvrvLookup.reason ?? 'missing MVRV row';
    setFeature('mvrvLevel', mvrv?.mvrv, mvrvSourceDate, mvrvMissingReason);
    setFeature(
      'mvrvPercentile',
      Number.isFinite(mvrv?.mvrv) ? percentileRank(runningMvrvValues, mvrv.mvrv) : null,
      mvrvSourceDate,
      mvrv ? 'insufficient MVRV history' : mvrvMissingReason
    );
    setFeature(
      'mvrvZScore',
      Number.isFinite(mvrv?.mvrv) ? zScore(runningMvrvValues, mvrv.mvrv) : null,
      mvrvSourceDate,
      mvrv ? 'insufficient MVRV history' : mvrvMissingReason
    );

    const realizedPrice = onchain?.metrics?.realizedPriceUSD;
    const onchainSourceDate = onchain?.date ?? sourceDate;
    const onchainMissingReason = onchainLookup.reason ?? 'missing on-chain row';
    setFeature('realizedPriceDistance', realizedPrice ? btc.close / realizedPrice - 1 : null, onchainSourceDate, onchainMissingReason === 'missing on-chain row' ? 'missing realized price' : onchainMissingReason);
    setFeature('activeAddresses', onchain?.metrics?.activeAddresses, onchainSourceDate, onchainMissingReason === 'missing on-chain row' ? 'missing active addresses' : onchainMissingReason);
    setFeature('transactionCount', onchain?.metrics?.transactionCount, onchainSourceDate, onchainMissingReason === 'missing on-chain row' ? 'missing transaction count' : onchainMissingReason);
    setFeature('transferCount', onchain?.metrics?.transferCount, onchainSourceDate, onchainMissingReason === 'missing on-chain row' ? 'missing transfer count' : onchainMissingReason);
    setFeature('addressBalanceCount', onchain?.metrics?.addressBalanceCount, onchainSourceDate, onchainMissingReason === 'missing on-chain row' ? 'missing funded address count' : onchainMissingReason);
    setFeature(
      'transfersPerTransaction',
      onchain?.metrics?.transferCount && onchain?.metrics?.transactionCount ? onchain.metrics.transferCount / onchain.metrics.transactionCount : null,
      onchainSourceDate,
      onchainMissingReason === 'missing on-chain row' ? 'missing transfer or transaction count' : onchainMissingReason
    );
    setFeature(
      'activeAddressShare',
      onchain?.metrics?.activeAddresses && onchain?.metrics?.addressBalanceCount ? onchain.metrics.activeAddresses / onchain.metrics.addressBalanceCount : null,
      onchainSourceDate,
      onchainMissingReason === 'missing on-chain row' ? 'missing active or funded address count' : onchainMissingReason
    );
    setFeature('hashRate', onchain?.metrics?.hashRate, onchainSourceDate, onchainMissingReason === 'missing on-chain row' ? 'missing hash rate' : onchainMissingReason);
    setFeature(
      'minerStressProxy',
      onchain?.metrics?.minerRevenueUSD && btc.close ? onchain.metrics.minerRevenueUSD / onchain.metrics.marketCapUSD : null,
      onchainSourceDate,
      onchainMissingReason === 'missing on-chain row' ? 'missing miner revenue' : onchainMissingReason
    );

    setFeature('volatilityRegime30d', realizedVolatility(btcRows, index - 1, 30), sourceDate, 'insufficient volatility lookback');
    setFeature('drawdownFromCycleHigh', drawdownFromHigh(btcRows, index - 1), sourceDate, 'missing BTC history');
    const derivativeFeatureNames = [
      'futuresFundingRateDailyAvg',
      'futuresFundingRateDailySum',
      'futuresFundingRateSum7d',
      'futuresFundingRateSum30d',
      'futuresFundingRateSumZ90d',
      'futuresFundingRateAvgZ90d',
      'futuresPremiumClose',
      'futuresPremiumCloseZ90d',
      'futuresPremiumRange',
      'futuresOpenInterestUSD',
      'futuresOpenInterestToMarketCap',
    ];
    if (isDerivativeRowAvailable(derivatives, rowDate)) {
      setFeature('futuresFundingRateDailyAvg', derivatives.metrics.fundingRateDailyAvg, sourceDate, 'missing derivatives funding');
      setFeature('futuresFundingRateDailySum', derivatives.metrics.fundingRateDailySum, sourceDate, 'missing derivatives funding');
      setFeature('futuresFundingRateSum7d', derivatives.metrics.fundingRateSum7d, sourceDate, 'missing derivatives funding lookback');
      setFeature('futuresFundingRateSum30d', derivatives.metrics.fundingRateSum30d, sourceDate, 'missing derivatives funding lookback');
      setFeature('futuresFundingRateSumZ90d', derivatives.metrics.fundingRateSumZ90d, sourceDate, 'missing derivatives funding z-score');
      setFeature('futuresFundingRateAvgZ90d', derivatives.metrics.fundingRateAvgZ90d, sourceDate, 'missing derivatives funding z-score');
      setFeature('futuresPremiumClose', derivatives.metrics.premiumClose, sourceDate, 'missing derivatives premium');
      setFeature('futuresPremiumCloseZ90d', derivatives.metrics.premiumCloseZ90d, sourceDate, 'missing derivatives premium z-score');
      setFeature('futuresPremiumRange', derivatives.metrics.premiumRange, sourceDate, 'missing derivatives premium range');
      setFeature('futuresOpenInterestUSD', derivatives.metrics.openInterestUSD, sourceDate, 'missing derivatives open interest');
      setFeature(
        'futuresOpenInterestToMarketCap',
        derivatives.metrics.openInterestUSD && mvrv?.marketCap ? derivatives.metrics.openInterestUSD / mvrv.marketCap : null,
        mvrv ? [sourceDate, mvrvSourceDate].sort()[0] : sourceDate,
        'missing derivatives open interest or market cap'
      );
    } else {
      for (const feature of derivativeFeatureNames) {
        missingFeatureReasons[feature] = 'missing derivatives row or unavailableAfter timing';
      }
    }

    if (isTimedRowAvailable(stablecoin, rowDate)) {
      setFeature('stablecoinSupplyUSD', stablecoin.metrics.totalSupplyUSD, sourceDate, 'missing stablecoin supply');
      setFeature('stablecoinSupplyChange7d', stablecoin.metrics.totalSupplyChange7d, sourceDate, 'missing stablecoin 7d change');
      setFeature('stablecoinSupplyChange30d', stablecoin.metrics.totalSupplyChange30d, sourceDate, 'missing stablecoin 30d change');
      setFeature('stablecoinSupplyChange90d', stablecoin.metrics.totalSupplyChange90d, sourceDate, 'missing stablecoin 90d change');
      setFeature('stablecoinSupplyChange365d', stablecoin.metrics.totalSupplyChange365d, sourceDate, 'missing stablecoin 365d change');
      setFeature('stablecoinSupplyZ365d', stablecoin.metrics.totalSupplyZ365d, sourceDate, 'missing stablecoin z-score');
      setFeature('stablecoinLiquidityImpulse30dVsAnnual', stablecoin.metrics.liquidityImpulse30dVsAnnual, sourceDate, 'missing stablecoin liquidity impulse');
      setFeature(
        'stablecoinSupplyToBtcMarketCap',
        stablecoin.metrics.totalSupplyUSD && mvrv?.marketCap ? stablecoin.metrics.totalSupplyUSD / mvrv.marketCap : null,
        sourceDate,
        'missing stablecoin supply or BTC market cap'
      );
    }

    if (isTimedRowAvailable(sentiment, rowDate)) {
      setFeature('fearGreedIndex', sentiment.metrics.fearGreedIndex, sourceDate, 'missing sentiment index');
      setFeature('fearGreedChange7d', sentiment.metrics.fearGreedChange7d, sourceDate, 'missing sentiment 7d change');
      setFeature('fearGreedChange30d', sentiment.metrics.fearGreedChange30d, sourceDate, 'missing sentiment 30d change');
      setFeature('extremeFearEvent', sentiment.metrics.extremeFear, sourceDate, 'missing sentiment extreme fear flag');
      setFeature('extremeGreedEvent', sentiment.metrics.extremeGreed, sourceDate, 'missing sentiment extreme greed flag');
      setFeature(
        'fearGreedResidualDivergence',
        Number.isFinite(sentiment.metrics.fearGreedIndex) && Number.isFinite(features.priceResidualLog)
          ? ((sentiment.metrics.fearGreedIndex - 50) / 50) - features.priceResidualLog
          : null,
        sourceDate,
        'missing sentiment index or price residual'
      );
    }

    const cotFeatureNames = [
      'cmeCotOpenInterestBtc',
      'cmeCotLeveragedMoneyNetPctOi',
      'cmeCotLeveragedMoneyNetPctRank',
      'cmeCotAssetManagerNetPctOi',
      'cmeCotAssetManagerNetPctRank',
      'cmeCotDealerNetPctOi',
      'cmeCotDealerNetPctRank',
      'cmeCotOpenInterestChange4w',
      'cmeCotOpenInterestPctRank',
    ];
    if (cot?.metrics) {
      setFeature('cmeCotOpenInterestBtc', cot.metrics.openInterestBtc, cot.date, 'missing COT open interest');
      setFeature('cmeCotLeveragedMoneyNetPctOi', cot.metrics.leveragedMoneyNetPctOi, cot.date, 'missing COT leveraged-money net');
      setFeature('cmeCotLeveragedMoneyNetPctRank', cot.metrics.leveragedMoneyNetPctRank, cot.date, 'missing COT leveraged-money percentile');
      setFeature('cmeCotAssetManagerNetPctOi', cot.metrics.assetManagerNetPctOi, cot.date, 'missing COT asset-manager net');
      setFeature('cmeCotAssetManagerNetPctRank', cot.metrics.assetManagerNetPctRank, cot.date, 'missing COT asset-manager percentile');
      setFeature('cmeCotDealerNetPctOi', cot.metrics.dealerNetPctOi, cot.date, 'missing COT dealer net');
      setFeature('cmeCotDealerNetPctRank', cot.metrics.dealerNetPctRank, cot.date, 'missing COT dealer percentile');
      setFeature('cmeCotOpenInterestChange4w', cot.metrics.openInterestChange4w, cot.date, 'missing COT OI change');
      setFeature('cmeCotOpenInterestPctRank', cot.metrics.openInterestPctRank, cot.date, 'missing COT OI percentile');
    } else if (cotLookup.reason) {
      for (const feature of cotFeatureNames) missingFeatureReasons[feature] = cotLookup.reason;
    }

    const macroFeatureNames = [
      'macroFedBalanceSheetChange13w',
      'macroFedBalanceSheetChange26w',
      'macroFedFundsRate',
      'macroFedFundsChange13w',
      'macroTreasury10yYield',
      'macroTreasury10yChange30d',
      'macroTreasury10yChange90d',
      'macroHighYieldSpread',
      'macroHighYieldSpreadZ252d',
      'macroM2Change26w',
      'macroLiquidityImpulseZ252d',
      'macroRiskScore',
    ];
    if (macro?.metrics) {
      setFeature('macroFedBalanceSheetChange13w', macro.metrics.fedBalanceSheetChange13w, macro.date, 'missing macro Fed balance sheet 13w change');
      setFeature('macroFedBalanceSheetChange26w', macro.metrics.fedBalanceSheetChange26w, macro.date, 'missing macro Fed balance sheet 26w change');
      setFeature('macroFedFundsRate', macro.metrics.fedFundsRate, macro.date, 'missing macro Fed funds');
      setFeature('macroFedFundsChange13w', macro.metrics.fedFundsChange13w, macro.date, 'missing macro Fed funds change');
      setFeature('macroTreasury10yYield', macro.metrics.treasury10yYield, macro.date, 'missing macro 10y yield');
      setFeature('macroTreasury10yChange30d', macro.metrics.treasury10yChange30d, macro.date, 'missing macro 10y 30d change');
      setFeature('macroTreasury10yChange90d', macro.metrics.treasury10yChange90d, macro.date, 'missing macro 10y 90d change');
      setFeature('macroHighYieldSpread', macro.metrics.highYieldSpread, macro.date, 'missing macro high-yield spread');
      setFeature('macroHighYieldSpreadZ252d', macro.metrics.highYieldSpreadZ252d, macro.date, 'missing macro high-yield spread z-score');
      setFeature('macroM2Change26w', macro.metrics.m2Change26w, macro.date, 'missing macro M2 change');
      setFeature('macroLiquidityImpulseZ252d', macro.metrics.liquidityImpulseZ252d, macro.date, 'missing macro liquidity impulse');
      setFeature('macroRiskScore', macro.metrics.macroRiskScore, macro.date, 'missing macro risk score');
    } else if (macroLookup.reason) {
      for (const feature of macroFeatureNames) missingFeatureReasons[feature] = macroLookup.reason;
    }

    const etfFeatureNames = [
      'spotEtfFlowUSD',
      'spotEtfFlow5dUSD',
      'spotEtfFlow20dUSD',
      'spotEtfCumulativeFlowUSD',
      'spotEtfFlowToBtcMarketCap',
      'spotEtfFlow20dToBtcMarketCap',
      'spotEtfFlow5dToBtcMarketCap',
      'spotEtfFlowShockZ90d',
    ];
    if (etf?.metrics) {
      setFeature('spotEtfFlowUSD', etf.metrics.totalFlowUSD, etf.date, 'missing spot ETF daily flow');
      setFeature('spotEtfFlow5dUSD', trailingMetricSum(etfRows, etf.date, 5, 'totalFlowUSD'), etf.date, 'missing spot ETF 5d flow');
      setFeature('spotEtfFlow20dUSD', trailingMetricSum(etfRows, etf.date, 20, 'totalFlowUSD'), etf.date, 'missing spot ETF 20d flow');
      setFeature('spotEtfCumulativeFlowUSD', etf.metrics.cumulativeFlowUSD, etf.date, 'missing spot ETF cumulative flow');
      setFeature(
        'spotEtfFlowToBtcMarketCap',
        Number.isFinite(etf.metrics.totalFlowUSD) && mvrv?.marketCap ? etf.metrics.totalFlowUSD / mvrv.marketCap : null,
        etf.date,
        'missing spot ETF daily flow or BTC market cap'
      );
      setFeature(
        'spotEtfFlow20dToBtcMarketCap',
        mvrv?.marketCap ? (trailingMetricSum(etfRows, etf.date, 20, 'totalFlowUSD') ?? NaN) / mvrv.marketCap : null,
        etf.date,
        'missing spot ETF 20d flow or BTC market cap'
      );
      setFeature(
        'spotEtfFlow5dToBtcMarketCap',
        mvrv?.marketCap ? (trailingMetricSum(etfRows, etf.date, 5, 'totalFlowUSD') ?? NaN) / mvrv.marketCap : null,
        etf.date,
        'missing spot ETF 5d flow or BTC market cap'
      );
      setFeature('spotEtfFlowShockZ90d', trailingMetricZScore(etfRows, etf.date, 90, 'totalFlowUSD'), etf.date, 'missing spot ETF flow z-score');
    } else if (etfLookup.reason) {
      for (const feature of etfFeatureNames) missingFeatureReasons[feature] = etfLookup.reason;
    }

    rows.push({ date: rowDate, features, sourceDates, missingFeatureReasons });
  }

  writeFileSync(OUT_PATH, `${JSON.stringify(rows)}\n`);
  const latest = rows.at(-1);
  console.log(
    [
      '[Feature table] built',
      `rows=${rows.length}`,
      `first=${rows[0]?.date}`,
      `last=${latest?.date}`,
      `latestFeatureCount=${latest ? Object.keys(latest.features).length : 0}`,
      `path=${OUT_PATH}`,
    ].join('  ')
  );
}

function realizedVolatility(rows: OHLCVData[], endIndex: number, lookback: number): number | null {
  if (endIndex < lookback) return null;
  const window = rows.slice(endIndex - lookback, endIndex + 1);
  const returns = window.slice(1).map((row, i) => Math.log(row.close / window[i].close));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 365);
}

function drawdownFromHigh(rows: OHLCVData[], endIndex: number): number {
  let high = 0;
  for (let i = 0; i <= endIndex; i++) high = Math.max(high, rows[i].close);
  return high > 0 ? rows[endIndex].close / high - 1 : 0;
}

function percentileRank(values: number[], value: number): number | null {
  if (values.length < 30) return null;
  const belowOrEqual = values.filter(item => item <= value).length;
  return belowOrEqual / values.length;
}

function zScore(values: number[], value: number): number | null {
  if (values.length < 30) return null;
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  const variance = values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (value - mean) / sd : null;
}

function addUtcDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().split('T')[0];
}

function isDerivativeRowAvailable(row: any, forecastDate: string): boolean {
  return isTimedRowAvailable(row, forecastDate);
}

function isTimedRowAvailable(row: any, forecastDate: string): boolean {
  if (!row?.metrics) return false;
  if (!row.availableAfter) return true;
  return Date.parse(row.availableAfter) <= Date.parse(`${forecastDate}T00:00:00Z`);
}

function isAvailableSourceRow(row: any, forecastDate: string): boolean {
  if (!row) return false;
  if (!row.availableAfter) return true;
  return Date.parse(row.availableAfter) <= Date.parse(`${forecastDate}T00:00:00Z`);
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / MS_PER_DAY);
}

export function latestSourceRow(
  rows: any[],
  expectedSourceDate: string,
  forecastDate: string,
  maxAgeDays: number,
  sourceName: string
): SourceLookup {
  let latest: any | null = null;
  for (const row of rows) {
    if (row.date > expectedSourceDate) break;
    if (isAvailableSourceRow(row, forecastDate)) latest = row;
  }
  if (!latest) return { row: null, reason: `${sourceName} source row unavailable by ${forecastDate}` };
  const ageDays = daysBetween(latest.date, expectedSourceDate);
  if (ageDays > maxAgeDays) {
    return {
      row: null,
      reason: `${sourceName} source date ${latest.date} is ${ageDays} days behind expected ${expectedSourceDate}; exceeds ${maxAgeDays}-day forward-fill cap`,
    };
  }
  return { row: latest, reason: null };
}

function latestTimedRow(
  rows: any[],
  sourceDate: string,
  forecastDate: string,
  maxAgeDays: number,
  sourceName: string
): SourceLookup {
  const lookup = latestSourceRow(rows, sourceDate, forecastDate, maxAgeDays, sourceName);
  if (lookup.row && !lookup.row.metrics) {
    return { row: null, reason: `${sourceName} row has no metrics` };
  }
  return lookup;
}

function trailingMetricSum(rows: any[], date: string, lookback: number, metric: string): number | null {
  const index = rows.findIndex(row => row.date === date);
  if (index < lookback - 1) return null;
  const window = rows.slice(index - lookback + 1, index + 1);
  if (window.length !== lookback || window.some(row => !Number.isFinite(row.metrics?.[metric]))) return null;
  return window.reduce((sum, row) => sum + row.metrics[metric], 0);
}

function trailingMetricZScore(rows: any[], date: string, lookback: number, metric: string): number | null {
  const index = rows.findIndex(row => row.date === date);
  if (index < lookback) return null;
  const prior = rows.slice(index - lookback, index).map(row => row.metrics?.[metric]).filter(Number.isFinite);
  if (prior.length < lookback) return null;
  const current = rows[index]?.metrics?.[metric];
  if (!Number.isFinite(current)) return null;
  const mean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  const variance = prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / prior.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (current - mean) / sd : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
