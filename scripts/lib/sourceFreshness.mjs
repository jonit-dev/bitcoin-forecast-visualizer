// One table owns the freshness policy used by the feature builder, runtime
// summary, and freshness gate. Optional sources still get a cap so stale data
// is visible instead of being carried indefinitely.
export const SOURCE_FRESHNESS_CAP_DAYS = Object.freeze({
  btc: 3,
  mvrv: 3,
  onchain: 3,
  features: 3,
  derivatives: 3,
  stablecoins: 3,
  sentiment: 7,
  cot: 10,
  macro: 45,
  etf: 5,
  voo: 7,
});

export const ONCHAIN_FORWARD_FILL_CAP_DAYS = SOURCE_FRESHNESS_CAP_DAYS.onchain;
