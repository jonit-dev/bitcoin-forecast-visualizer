# Plan: Liquidation Map Influence on Heatmap

## Context
The app has a Monte Carlo probability heatmap showing forecast price density. We want to add a liquidation map that biases this heatmap — simulating how price paths are attracted toward dense liquidation clusters (liquidity hunts).

No external API needed: liquidation levels will be estimated from existing OHLCV data.

## How Liquidation Maps Work
- **Long liquidations**: Below current price (longs liquidated if price drops)
- **Short liquidations**: Above current price (shorts liquidated if price rises)
- Price tends to **wick toward** dense liquidation zones — market makers hunt stops
- This means heatmap paths should be slightly biased toward high-liquidation price levels

## Implementation

### 1. `src/lib/data.ts` — Add `estimateLiquidationLevels()`

```typescript
interface LiquidationLevel {
  price: number;
  density: number;   // 0-1 normalized intensity
  side: 'long' | 'short';
}
```

Estimation algorithm (from existing OHLCV):
- Take last 90 days of candles
- Collect all highs and lows as candidate stop/liquidation prices
- Kernel density estimation (Gaussian, bandwidth ~0.5%) to find clusters
- Split by side: levels below current price = long liquidations, above = short
- Round-number bonus: add weight at $1k/$5k/$10k round levels
- Return top ~20 levels sorted by density

### 2. `src/lib/data.ts` — Modify `generateHeatmapData()`

Add `liquidationBias` parameter (0–1, default 0.3).

In the GBM simulation loop, for each step:
```
// Find nearest liquidation level to current simulated price
// Add a small drift nudge toward it, scaled by liquidation density * bias
nudge = (liqLevel - currentPrice) / currentPrice * density * liquidationBias * dt
path[t+1] = path[t] * exp(drift + nudge + vol * dW)
```

Effect: paths are slightly gravitationally pulled toward liquidation clusters, increasing probability density at those price levels in the output heatmap.

### 3. `src/components/Chart.tsx` — Add `LiquidationOverlayPrimitive`

New canvas primitive that renders on top of the heatmap:
- **Horizontal dashed lines** at each liquidation level price
- Color: **red tint** for long liquidations (below price), **green tint** for short liquidations (above price)
- Opacity proportional to density
- Small label on right side: "Liq" with density indicator

Only renders during forecast zone (future dates), not historical.

### 4. `src/App.tsx` — Wire up

- Call `estimateLiquidationLevels(marketData.ohlcv)` alongside existing data loading
- Pass levels to `Chart` component as new `liquidationLevels` prop
- Pass levels to `generateHeatmapData()` as bias parameter
- Add toggle: **"Liq Map"** switch in the display controls row (next to SMA, Volume, Model, Heatmap)

## Critical Files
- `src/lib/data.ts` — new function + modify `generateHeatmapData`
- `src/components/Chart.tsx` — new primitive, wire to `liquidationLevels` prop
- `src/App.tsx` — toggle state, pass data down

## Verification
1. `npm run dev` — app loads without errors
2. Enable Heatmap + Liq Map toggles
3. Confirm horizontal lines appear in forecast zone at reasonable price levels
4. Compare heatmap with/without bias: density should cluster more around liquidation levels when enabled
5. Verify long liq lines are below current price, short liq lines above
