export type MarketAssetId = 'btc' | 'sp500' | 'gold';

export interface AssetConfig {
  id: MarketAssetId;
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
export const REPAIR_LOOKBACK_DAYS = 7;
