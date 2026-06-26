import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import mvrvHistory from '../src/data/mvrv-history.json';
import onchainHistory from '../src/data/onchain-history.json';
import derivativesHistory from '../src/data/derivatives-history.json';
import stablecoinHistory from '../src/data/stablecoin-history.json';
import sentimentHistory from '../src/data/sentiment-history.json';
import type { OHLCVData, MVRVPoint } from '../src/lib/api';
import { basePowerLawPrice, daysSinceGenesis } from '../src/lib/powerLaw';

const OUT_PATH = join(process.cwd(), 'src/data/feature-table.json');
const MS_PER_DAY = 86400000;

interface FeatureRow {
  date: string;
  features: Record<string, number>;
  sourceDates: Record<string, string>;
  missingFeatureReasons: Record<string, string>;
}

function main(): void {
  const btcRows = btcHistory as OHLCVData[];
  const mvrvRows = mvrvHistory as MVRVPoint[];
  const onchainRows = onchainHistory as any[];
  const derivativesRows = (derivativesHistory as any).rows ?? [];
  const stablecoinRows = (stablecoinHistory as any).rows ?? [];
  const sentimentRows = (sentimentHistory as any).rows ?? [];
  const btcByDate = new Map(btcRows.map(row => [row.date, row]));
  const mvrvByDate = new Map(mvrvRows.map(row => [row.date, row]));
  const onchainByDate = new Map(onchainRows.map(row => [row.date, row]));
  const derivativesByDate = new Map(derivativesRows.map((row: any) => [row.date, row]));
  const stablecoinByDate = new Map(stablecoinRows.map((row: any) => [row.date, row]));
  const sentimentByDate = new Map(sentimentRows.map((row: any) => [row.date, row]));
  const rows: FeatureRow[] = [];
  const runningMvrvValues: number[] = [];

  for (let index = 1; index < btcRows.length; index++) {
    const rowDate = btcRows[index].date;
    const sourceDate = addUtcDays(rowDate, -1);
    const btc = btcByDate.get(sourceDate);
    if (!btc) continue;

    const mvrv = mvrvByDate.get(sourceDate);
    if (mvrv?.mvrv) runningMvrvValues.push(mvrv.mvrv);

    const onchain = onchainByDate.get(sourceDate);
    const derivatives = derivativesByDate.get(sourceDate) as any;
    const stablecoin = stablecoinByDate.get(sourceDate) as any;
    const sentiment = sentimentByDate.get(sourceDate) as any;
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

    setFeature('mvrvLevel', mvrv?.mvrv, sourceDate, 'missing MVRV row');
    setFeature('mvrvPercentile', mvrv?.mvrv ? percentileRank(runningMvrvValues, mvrv.mvrv) : null, sourceDate, 'missing MVRV row');
    setFeature('mvrvZScore', mvrv?.mvrv ? zScore(runningMvrvValues, mvrv.mvrv) : null, sourceDate, 'missing MVRV row');

    const realizedPrice = onchain?.metrics?.realizedPriceUSD;
    setFeature('realizedPriceDistance', realizedPrice ? btc.close / realizedPrice - 1 : null, sourceDate, 'missing realized price');
    setFeature('activeAddresses', onchain?.metrics?.activeAddresses, sourceDate, 'missing active addresses');
    setFeature('transactionCount', onchain?.metrics?.transactionCount, sourceDate, 'missing transaction count');
    setFeature('transferCount', onchain?.metrics?.transferCount, sourceDate, 'missing transfer count');
    setFeature('addressBalanceCount', onchain?.metrics?.addressBalanceCount, sourceDate, 'missing funded address count');
    setFeature(
      'transfersPerTransaction',
      onchain?.metrics?.transferCount && onchain?.metrics?.transactionCount ? onchain.metrics.transferCount / onchain.metrics.transactionCount : null,
      sourceDate,
      'missing transfer or transaction count'
    );
    setFeature(
      'activeAddressShare',
      onchain?.metrics?.activeAddresses && onchain?.metrics?.addressBalanceCount ? onchain.metrics.activeAddresses / onchain.metrics.addressBalanceCount : null,
      sourceDate,
      'missing active or funded address count'
    );
    setFeature('hashRate', onchain?.metrics?.hashRate, sourceDate, 'missing hash rate');
    setFeature(
      'minerStressProxy',
      onchain?.metrics?.minerRevenueUSD && btc.close ? onchain.metrics.minerRevenueUSD / onchain.metrics.marketCapUSD : null,
      sourceDate,
      'missing miner revenue'
    );

    setFeature('volatilityRegime30d', realizedVolatility(btcRows, index - 1, 30), sourceDate, 'insufficient volatility lookback');
    setFeature('drawdownFromCycleHigh', drawdownFromHigh(btcRows, index - 1), sourceDate, 'missing BTC history');
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
        sourceDate,
        'missing derivatives open interest or market cap'
      );
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

main();
