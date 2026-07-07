import type { OHLCVData } from './api';
import type { FeatureRow } from './features';
import { powerLawForecast } from './powerLaw';

export type FeatureFamily =
  | 'onchain'
  | 'derivatives'
  | 'etf'
  | 'macro'
  | 'sentiment'
  | 'stablecoins'
  | 'cot';

export interface FeatureFamilySpec {
  family: FeatureFamily;
  featureNames: string[];
}

export interface ResidualDatasetRow {
  originDate: string;
  targetDate: string;
  horizonDays: number;
  actualClose: number;
  baselineMedian: number;
  targetResidualLog: number;
  features: Record<string, number>;
}

export interface ResidualDatasetSummary {
  family: FeatureFamily;
  horizonDays: number;
  holdoutStart: string;
  rawRows: number;
  lagSafeRows: number;
  filteredRows: number;
  skipped: {
    missingFeatureRow: number;
    futureSourceDate: number;
    missingFeatureValue: number;
    invalidForecast: number;
  };
}

export interface ResidualDatasetResult {
  rows: ResidualDatasetRow[];
  summary: ResidualDatasetSummary;
}

export const FEATURE_FAMILIES: Record<FeatureFamily, FeatureFamilySpec> = {
  onchain: {
    family: 'onchain',
    featureNames: [
      'mvrvLevel',
      'mvrvPercentile',
      'mvrvZScore',
      'realizedPriceDistance',
      'activeAddresses',
      'transactionCount',
      'transferCount',
      'addressBalanceCount',
      'transfersPerTransaction',
      'activeAddressShare',
      'hashRate',
      'minerStressProxy',
    ],
  },
  derivatives: {
    family: 'derivatives',
    featureNames: [
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
    ],
  },
  etf: {
    family: 'etf',
    featureNames: [
      'spotEtfFlowUSD',
      'spotEtfFlow5dUSD',
      'spotEtfFlow20dUSD',
      'spotEtfCumulativeFlowUSD',
      'spotEtfFlowToBtcMarketCap',
      'spotEtfFlow20dToBtcMarketCap',
      'spotEtfFlow5dToBtcMarketCap',
      'spotEtfFlowShockZ90d',
    ],
  },
  macro: {
    family: 'macro',
    featureNames: [
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
    ],
  },
  sentiment: {
    family: 'sentiment',
    featureNames: [
      'fearGreedIndex',
      'fearGreedChange7d',
      'fearGreedChange30d',
      'extremeFearEvent',
      'extremeGreedEvent',
      'fearGreedResidualDivergence',
    ],
  },
  stablecoins: {
    family: 'stablecoins',
    featureNames: [
      'stablecoinSupplyUSD',
      'stablecoinSupplyChange7d',
      'stablecoinSupplyChange30d',
      'stablecoinSupplyChange90d',
      'stablecoinSupplyChange365d',
      'stablecoinSupplyZ365d',
      'stablecoinLiquidityImpulse30dVsAnnual',
      'stablecoinSupplyToBtcMarketCap',
    ],
  },
  cot: {
    family: 'cot',
    featureNames: [
      'cmeCotOpenInterestBtc',
      'cmeCotLeveragedMoneyNetPctOi',
      'cmeCotLeveragedMoneyNetPctRank',
      'cmeCotAssetManagerNetPctOi',
      'cmeCotAssetManagerNetPctRank',
      'cmeCotDealerNetPctOi',
      'cmeCotDealerNetPctRank',
      'cmeCotOpenInterestChange4w',
      'cmeCotOpenInterestPctRank',
    ],
  },
};

export const FEATURE_EXPERIMENT_HORIZONS = [7, 14, 30, 60, 90, 180] as const;
export const FEATURE_EXPERIMENT_HOLDOUTS = ['2022-01-01', '2025-01-01'] as const;
export const MIN_CONTINUOUS_FEATURE_ROWS = 60;

export function buildResidualFeatureDataset(input: {
  ohlcv: OHLCVData[];
  featureRows: FeatureRow[];
  family: FeatureFamily;
  horizonDays: number;
  holdoutStart: string;
  originStart?: string;
  originEndExclusive?: string;
}): ResidualDatasetResult {
  const spec = FEATURE_FAMILIES[input.family];
  const featureByDate = new Map(input.featureRows.map(row => [row.date, row]));
  const originStart = input.originStart ?? input.holdoutStart;
  const skipped = {
    missingFeatureRow: 0,
    futureSourceDate: 0,
    missingFeatureValue: 0,
    invalidForecast: 0,
  };
  let rawRows = 0;
  let lagSafeRows = 0;
  const rows: ResidualDatasetRow[] = [];

  for (let originIndex = 365; originIndex + input.horizonDays < input.ohlcv.length; originIndex++) {
    const origin = input.ohlcv[originIndex];
    if (origin.date < originStart) continue;
    if (input.originEndExclusive && origin.date >= input.originEndExclusive) continue;
    rawRows++;
    const featureRow = featureByDate.get(origin.date);
    if (!featureRow) {
      skipped.missingFeatureRow++;
      continue;
    }
    if (!isFeatureRowLagSafe(featureRow, spec.featureNames, origin.date)) {
      skipped.futureSourceDate++;
      continue;
    }
    lagSafeRows++;
    const features = pickFiniteFeatures(featureRow, spec.featureNames);
    if (Object.keys(features).length !== spec.featureNames.length) {
      skipped.missingFeatureValue++;
      continue;
    }

    const target = input.ohlcv[originIndex + input.horizonDays];
    const originDate = parseDate(origin.date);
    const targetDate = parseDate(target.date);
    const baselineMedian = powerLawForecast(targetDate, origin.close, originDate);
    if (!Number.isFinite(baselineMedian) || baselineMedian <= 0 || target.close <= 0) {
      skipped.invalidForecast++;
      continue;
    }
    rows.push({
      originDate: origin.date,
      targetDate: target.date,
      horizonDays: input.horizonDays,
      actualClose: target.close,
      baselineMedian,
      targetResidualLog: Math.log(target.close / baselineMedian),
      features,
    });
  }

  return {
    rows,
    summary: {
      family: input.family,
      horizonDays: input.horizonDays,
      holdoutStart: input.holdoutStart,
      rawRows,
      lagSafeRows,
      filteredRows: rows.length,
      skipped,
    },
  };
}

export function assertFeatureRowLagSafe(row: FeatureRow, featureNames: string[], originDate: string): void {
  const unsafe = featureNames.filter(name => {
    const sourceDate = row.sourceDates[name];
    return sourceDate && sourceDate >= originDate;
  });
  if (unsafe.length > 0) {
    throw new Error(`Feature row ${row.date} has sourceDate >= originDate ${originDate}: ${unsafe.join(', ')}`);
  }
}

function isFeatureRowLagSafe(row: FeatureRow, featureNames: string[], originDate: string): boolean {
  try {
    assertFeatureRowLagSafe(row, featureNames, originDate);
    return true;
  } catch {
    return false;
  }
}

function pickFiniteFeatures(row: FeatureRow, featureNames: string[]): Record<string, number> {
  const features: Record<string, number> = {};
  for (const name of featureNames) {
    const value = row.features[name];
    if (Number.isFinite(value)) features[name] = value;
  }
  return features;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
