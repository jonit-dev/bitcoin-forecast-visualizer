export type MarketAssetId = 'btc' | 'sp500' | 'gold';
/** Every stored series. VIX is an input to the S&P 500 forecast width, never a served asset. */
export type SeriesId = MarketAssetId | 'vix';

export interface AssetConfig {
  id: SeriesId;
  source: 'coingecko' | 'yahoo';
  symbol: string;
  staleAfterDays: number;
}

export const MARKET_ASSET_REGISTRY: Record<MarketAssetId, AssetConfig> = {
  btc: { id: 'btc', source: 'coingecko', symbol: 'bitcoin', staleAfterDays: 2 },
  sp500: { id: 'sp500', source: 'yahoo', symbol: 'VOO', staleAfterDays: 3 },
  gold: { id: 'gold', source: 'yahoo', symbol: 'GLD', staleAfterDays: 3 },
};

export const MARKET_ASSET_IDS = Object.keys(MARKET_ASSET_REGISTRY) as MarketAssetId[];
export const VIX_SERIES: AssetConfig = { id: 'vix', source: 'yahoo', symbol: '^VIX', staleAfterDays: 3 };
/** Every series the scheduled refresh writes. */
export const REFRESH_SERIES: AssetConfig[] = [...Object.values(MARKET_ASSET_REGISTRY), VIX_SERIES];
export const REPAIR_LOOKBACK_DAYS = 7;
// CoinGecko's hourly range payload is only practical for about a month. A
// longer outage repair reads Yahoo daily history instead.
export const COINGECKO_HOURLY_MAX_DAYS = 31;
