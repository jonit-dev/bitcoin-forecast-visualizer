# Bitcoin Forecast Model Reliability Assessment

Date: 2026-06-05  
Dataset reviewed: `src/data/btc-history.json` through 2026-06-04, `src/data/mvrv-history.json` through 2026-06-04  
Scope: project code, cached data, model scripts, and public data-source options.

## Executive Summary

Overall reliability score: **58 / 100**.

This is a reasonable exploratory Bitcoin-cycle visualization model, not a high-confidence trading forecast. The strongest part is the short-to-medium horizon power-law mean-reversion baseline: in the 2022-01-01 through 2026-06-04 holdout, median endpoint error was about **7% at 14 days**, **11% at 30 days**, **16% at 60 days**, and **18% at 90 days** in multiplicative terms. That is useful for scenario framing and rough directional context.

The weakest part is structural certainty. The model depends on a small number of fitted constants, assumes the power-law/cycle structure remains valid, and does not include macro liquidity, derivatives leverage, ETF flows, stablecoin liquidity, exchange flows, or on-chain cohort behavior. Its probability bands are intentionally conservative, and after 60 days they are so wide that they are better interpreted as "risk envelope" than actionable probability.

Reliability by use case:

| Use case | Score | Notes |
| --- | ---: | --- |
| Visual cycle context | 75 / 100 | Good for showing power-law bands, prior cycle pivots, MVRV, and broad state. |
| 14-30 day median forecast | 63 / 100 | Backtest error is moderate; still vulnerable to news/regime shocks. |
| 60-90 day median forecast | 55 / 100 | Useful as a baseline, but uncertainty expands quickly. |
| 6-12 month exact price target | 35 / 100 | Too regime-sensitive; bands are very wide. |
| Probability bands | 62 / 100 | Coverage is high, but the intervals are over-conservative beyond 30-60 days. |
| Cycle phase label as alpha | 40 / 100 | Descriptive, but current phase-regression script underperforms the baseline in holdout. |
| MVRV signal | 65 / 100 | Good valuation context; not sufficient as a timing signal alone. |

## What The Model Actually Does

### 1. Power-Law Price Model

`src/lib/powerLaw.ts` defines:

- A base power law from days since Bitcoin genesis.
- A sinusoidal cycle adjustment with a roughly four-year frequency.
- A floor and peak power-law envelope.
- A forecast function that anchors to current price and exponentially decays the current log residual back toward the base model over `210` days.

Core behavior:

```text
forecast = future_base_power_law_price * exp(current_log_residual * exp(-horizon_days / 210))
```

This is coherent and simple. It avoids blindly projecting recent drift forever and gives the current market state a decaying influence. The tradeoff is that the model is structurally committed to a long-term Bitcoin power law and a fixed mean-reversion speed.

### 2. Forecast Intervals And Heatmap

`src/lib/data.ts` estimates log-return volatility from a blend of recent 90-day and structural 365-day volatility:

```text
daily_vol = sqrt(0.55 * recent_vol^2 + 0.45 * structural_vol^2)
```

For the power-law heatmap, residual variance follows a decaying residual process. A fat-tail stress multiplier widens bands with horizon:

```text
stress = 1 + 1.85 * (1 - exp(-days / 150))
```

This is directionally sensible because Bitcoin residual errors are not Gaussian and long-horizon bands should be wide. The current multiplier is conservative.

### 3. Cycle Phase Model

`src/lib/cycle.ts` hardcodes completed ATH/ATL pivots through 2022-11-09 and projects future pivots using:

- ATL to ATH: `1064` days
- ATH to ATL: `364` days
- accumulation: first six months after ATL
- trim: last 30 days before projected ATH

This is easy to explain but brittle. It treats cycle lengths as fixed constants and does not adapt to macro regime, ETF-era demand, halving-supply effects, or actual price behavior after the latest known pivot.

### 4. MVRV Z-Score

`src/lib/api.ts` derives realized cap from CoinMetrics MVRV and market cap:

```text
realized_cap = market_cap / mvrv
z = (market_cap - realized_cap - historical_mean) / historical_stddev
```

This is broadly aligned with standard MVRV-Z logic. It is valuable as valuation context, but it is computed over the full available history, so distribution drift can affect the meaning of thresholds over time.

### 5. Drawdown Model

`src/lib/data.ts` includes a drawdown model based on only three completed post-halving cycles:

```text
projected_mdd_percent = 92.8 - 5.1 * cycle_index
```

This is the least statistically reliable component. The reported high fit is based on three points, so it should be treated as an illustrative heuristic, not a robust predictive model.

## Backtest Evidence

Commands run:

```bash
npm run analyze:heatmap-model
npm run analyze:phase-signal
npm run lint
```

### Median Forecast Error

Holdout: `2022-01-01` through `2026-06-04`.

| Horizon | Calibrated power-law mode MAE, log terms | Approx multiplicative error |
| ---: | ---: | ---: |
| 14d | 0.0716 | 7.4% |
| 30d | 0.1057 | 11.2% |
| 60d | 0.1503 | 16.2% |
| 90d | 0.1681 | 18.3% |

The calibrated recursive model improved versus the baseline fixed-vol model at every tested horizon:

| Horizon | Baseline avg NLL | Calibrated avg NLL | Result |
| ---: | ---: | ---: | --- |
| 14d | -0.9102 | -0.9318 | Better |
| 30d | -0.5777 | -0.5938 | Better |
| 60d | -0.2920 | -0.3225 | Better |
| 90d | -0.1745 | -0.2210 | Better |

### Probability Band Coverage

Rolling holdout interval check using the same power-law residual variance and stress multiplier:

| Horizon | Samples | Log MAE | 80% band coverage | 90% band coverage | 95% band coverage |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 14d | 1602 | 0.0709 | 87.5% | 93.1% | 96.1% |
| 30d | 1586 | 0.1034 | 92.0% | 97.2% | 99.1% |
| 60d | 1556 | 0.1469 | 98.7% | 100.0% | 100.0% |
| 90d | 1526 | 0.1662 | 99.9% | 100.0% | 100.0% |
| 180d | 1436 | 0.1727 | 100.0% | 100.0% | 100.0% |
| 365d | 1251 | 0.1377 | 100.0% | 100.0% | 100.0% |

Interpretation: the bands cover realized outcomes, but they are too wide at longer horizons. Good for avoiding false precision; weak for making precise probability claims.

### Phase Signal Backtest

The phase/residual regression looked strong in-sample, but underperformed the existing power-law forecast on the 2022+ holdout:

| Horizon | Baseline MAE | Phase-state MAE | Delta |
| ---: | ---: | ---: | ---: |
| 14d | 0.0709 | 0.0881 | +0.0172 worse |
| 30d | 0.1034 | 0.1309 | +0.0275 worse |
| 60d | 0.1469 | 0.1737 | +0.0268 worse |
| 90d | 0.1662 | 0.2095 | +0.0433 worse |

Conclusion: keep phase labels as explanatory overlays. Do not present them as an accuracy enhancer unless the phase model is redesigned and revalidated.

## Strengths

- **Simple, auditable math.** The model is transparent enough to inspect and explain.
- **Current-price anchoring.** Forecasts start from the latest candle and decay residuals instead of ignoring market state.
- **Reasonable short-horizon performance.** 14-30 day errors are not small, but they are usable for broad scenario visualization.
- **Conservative uncertainty display.** The long-horizon bands are not pretending Bitcoin is stable or Gaussian.
- **Good cached data hygiene.** BTC data and MVRV data are updated by scripts, and MVRV has a parity validator against CoinMetrics.
- **Separation of market context and forecast.** MVRV, power-law bands, cycle phases, and drawdown stats are separate enough to reason about independently.

## Weaknesses

- **The model is mostly univariate.** Price history dominates the forecast. Important external state is missing.
- **Hardcoded power-law coefficients.** There is no visible refit script, coefficient uncertainty, or walk-forward coefficient stability report.
- **Fixed cycle timing.** Projected ATH/ATL dates assume old cycle durations continue.
- **Gaussian assumptions remain under the hood.** The stress multiplier helps, but tails are still approximated rather than explicitly modeled.
- **Long-horizon intervals are over-conservative.** Coverage is excellent because the bands get very wide, not because the model is precise.
- **Drawdown regression has tiny sample size.** Three completed cycles are not enough to justify a confident drawdown formula.
- **MVRV thresholds are static.** Full-history z-scores can drift as Bitcoin matures.
- **No event/regime inputs.** ETF flows, Fed liquidity, exchange leverage, stablecoin supply, and miner stress can dominate short-to-medium moves.
- **No formal calibration report artifact.** The scripts print useful output, but results are not persisted or tracked over time.

## Recommended Public Data To Improve Accuracy

Priority 1: add public on-chain and valuation metrics from CoinMetrics.

The project already uses CoinMetrics MVRV and market cap. Extend this with metrics that capture realized-value behavior, network usage, miner stress, and supply/liquidity state. Candidate families:

- Realized cap and realized price directly, instead of deriving only from MVRV.
- NUPL or profit/loss style metrics where available.
- Active addresses, transaction count, transfer value, fees, hash rate, difficulty, miner revenue.
- Supply activity bands if available in the public/community tier.

Expected benefit: better regime classification and valuation-state modeling. This is the best match for the existing MVRV architecture.

Priority 2: add derivatives leverage data.

Use public or low-cost APIs for:

- BTC futures open interest.
- Funding rates.
- Long/short ratios.
- Liquidations.
- Options implied volatility if available.

Expected benefit: better short-term crash/squeeze risk detection. This would likely improve 7-30 day forecasts more than another power-law tweak.

Priority 3: add ETF flow and institutional demand proxies.

Add daily spot Bitcoin ETF net flows, cumulative flows, and assets under management from a reliable source. ETF demand can structurally alter cycle behavior after 2024.

Expected benefit: better medium-horizon regime detection in the ETF era.

Priority 4: add macro liquidity data from FRED.

Useful public macro series:

- Fed balance sheet (`WALCL`)
- effective federal funds rate
- 10-year Treasury yield
- high-yield credit spreads
- broad dollar index or liquidity proxies
- M2 or global liquidity proxies where available

Expected benefit: improved risk-on/risk-off context. This matters because Bitcoin is strongly regime-sensitive when global liquidity tightens or expands.

Priority 5: add sentiment and attention data.

Use Alternative.me Fear & Greed Index as a simple public sentiment feature. Add Google Trends or social-volume proxies only if the data is stable and reproducible.

Expected benefit: useful as a contrarian/context feature, but weaker than on-chain and derivatives data.

Priority 6: improve market data quality.

Current price candles are reconstructed from CoinGecko hourly range data and CryptoCompare daily volume. That is fine for visualization, but for modeling it would be better to store:

- Exchange-specific OHLCV from a high-liquidity venue such as Coinbase, Kraken, or Binance where legally/operationally appropriate.
- Aggregate spot volume from a consistent vendor.
- Clear UTC daily close convention.
- Reproducible raw-source snapshots.

Expected benefit: fewer silent vendor-methodology shifts and better volume-based features.

## Model Improvements Before Adding Complexity

1. **Persist calibration reports.** Turn the existing console scripts into versioned report outputs under `docs/reports` or `analysis/results`.
2. **Add walk-forward coefficient fitting.** Refit power-law coefficients only on data available at each historical date, then compare to the fixed coefficients.
3. **Replace fixed cycle dates with probabilistic cycle state.** Use a hidden-state or feature-based regime model rather than fixed ATL-to-ATH durations.
4. **Calibrate bands to target coverage by horizon.** Current long-horizon bands are too conservative. Tune 80/90/95% coverage separately for 14, 30, 60, 90, 180, and 365 days.
5. **Use quantile loss, not only MAE/NLL.** Forecast users care whether the probability distribution is calibrated, not only whether the median is close.
6. **Benchmark against simple baselines.** Compare against random walk, driftless GBM, 20/50/200-day trend models, and naive "current price" forecasts.
7. **Separate explanatory indicators from forecast inputs.** MVRV and cycle phase should remain overlays until they beat the baseline out of sample.

## Reliability Score Rationale

The score is **58 / 100** because:

- The core model is transparent and has tolerable 14-90 day holdout error.
- The calibrated power-law residual model improves over the simpler baseline in existing scripts.
- The interval bands are conservative enough to avoid false precision.
- However, the model misses major public explanatory variables and still relies on hardcoded cycle assumptions.
- The phase model has not proven out-of-sample value.
- Long-horizon forecasts should be treated as scenario visualization, not a reliable prediction.

Practical interpretation:

- **Above 70:** reliable enough to support decision tooling with calibrated probabilities.
- **55-70:** useful research/visualization model with clear caveats.
- **Below 55:** mostly illustrative.

This project currently sits in the middle category.

## Public Sources Checked

- CoinGecko historical market chart/range documentation: https://docs.coingecko.com/docs/2-get-historical-data
- CoinGecko API overview: https://www.coingecko.com/en/api
- CoinMetrics API documentation and Community API notes: https://docs.coinmetrics.io/api and https://coinmetrics.readthedocs.io/en/latest/community.html
- Mempool.space API documentation for Bitcoin network/mining/mempool endpoints: https://mempool.space/docs/api
- Alternative.me Fear & Greed Index API: https://alternative.me/crypto/fear-and-greed-index/
- CoinGlass API documentation for open interest, funding, liquidations, ETF data: https://docs.coinglass.com/v3.0/reference
- FRED API documentation: https://fred.stlouisfed.org/docs/api/fred/

## Bottom Line

The current model is credible as a Bitcoin forecast visualizer and cycle-context tool. It is not yet credible as a high-accuracy predictive model. The fastest path to higher reliability is not more curve fitting; it is adding public regime data, especially on-chain metrics, derivatives leverage, ETF flows, and macro liquidity, then proving each feature through walk-forward backtests.
