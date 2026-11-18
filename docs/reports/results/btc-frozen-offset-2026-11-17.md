# BTC frozen median offset

## Claim

A fixed bias correction to the BTC forecast median might reduce mean absolute log price error at 14, 30, 60, or 90 days. The candidate multiplies the shipped median and each quantile by the same factor, preserving interval width in log-price units. The comparators are the shipped power-law endpoint and price persistence with the existing driftless GBM bands.

## Data and evaluation

- Ran `npm run update:forecast-data` on November 17 Pacific (November 18 UTC). The 12 appended CoinGecko BTC candles and 12 appended CoinMetrics MVRV rows reach November 17 UTC. Every existing BTC and MVRV record matched the previous snapshot. The refresh also updated the existing market, on-chain, derivatives, stablecoin, ETF-flow, FRED, sentiment, and CFTC caches and regenerated runtime summaries.
- The model evaluation uses only bundled BTC daily UTC closes. There are 5,968 positive closes from July 17, 2010 through November 17, 2026, with zero date gaps. Input SHA-256 is `829f5416fcd5450371995e8e5bc6b4bfec74d5fd8f8d1d80ec9a14c3080e26e8`.
- Weekly origins follow a fixed seven-day calendar starting January 1, 2017. Fit one offset per horizon using only targets matured by December 31, 2021, yielding 248–259 fit origins. Score origins on or after January 1, 2022 on the same weekly calendar. The first scored origin is January 2, 2022. Refreshed target dates after November 5 contribute only 1–2 scored origins per horizon. There are zero matured prospective forecasts from origins after November 17.
- The offset is the median of `log(actual / incumbent median)` in the fit period. Scoring loss is `abs(log(actual / forecast median))`. A positive paired difference favors the candidate. The 95% percentile interval uses 5,000 circular moving-block resamples of paired losses, with blocks of `ceil(horizon / 7)` origins to account for overlapping targets. The one-sided bootstrap p-value uses centered resamples under the null, and Holm correction covers all four horizons.
- The historical replay uses fixed present-day incumbent coefficients and previously inspected evaluation periods. Its interval inputs only use prices through each origin. The coefficient vintage limitation and possible dependence beyond a horizon-length block limit this to development evidence.

The [registered gate](../experiments-backlog.md#2026-11-17--frozen-btc-median-offset-replay) requires at least a 2% gain, a positive confidence lower bound, Holm p below 0.05, a win over persistence and across both time subperiods, and non-inferiority on the other horizons, CRPS, and coverage. Production promotion also requires 30 non-overlapping prospective outcomes and the canonical backtest.

## Results

| Horizon | Scored origins | Incumbent MALE | Candidate MALE | Persistence MALE | Relative gain | Paired 95% interval | Holm p |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 14d | 253 | 0.071476 | 0.071450 | 0.074181 | +0.04% | [−0.000710, +0.000767] | 1.00 |
| 30d | 251 | 0.107592 | 0.107937 | 0.115054 | −0.32% | [−0.002248, +0.001586] | 1.00 |
| 60d | 246 | 0.152448 | 0.154793 | 0.174310 | −1.54% | [−0.013813, +0.009091] | 1.00 |
| 90d | 242 | 0.166556 | 0.171788 | 0.217358 | −3.14% | [−0.025096, +0.014562] | 1.00 |

All four horizons worsened in the 2025+ subperiod. Approximate CRPS rose 1.18% at 60 days and 3.02% at 90 days. Coverage fell 2.44 percentage points for the 60-day 95% interval and 2.89 points for the 90-day 80% interval. No other offset or parameter was tested. The candidate did not enter runtime.

Reproduce the replay with `npm exec -- tsx scripts/research-btc-frozen-offset.ts`. The [machine-readable result](btc-frozen-offset-2026-11-17.json) includes offsets, subgroup counts, calibration metrics, and seed. An independent validator reproduced that JSON byte for byte, checked the horizon selection and absence of future prices in replay inputs, and confirmed rejection. The script also asserts agreement between replay and current runtime median and quantiles on the latest origin.

## Refresh regression checks

- The [canonical BTC backtest](backtest-2026-11-18T03-22-20-396Z.md) passed its median accuracy gate at 14, 30, 60, and 90 days. Its separate robustness audit failed at 14 and 30 days against price persistence and driftless GBM. Both short-horizon point estimates still favored the incumbent, with bootstrap lower bounds below zero. The 60- and 90-day robustness tests passed.
- `npm run backtest:market-production` passed for S&P 500 and gold. Freshness, feature, on-chain, stablecoin, regime, ETF-flow, sentiment, and CFTC validation passed.
- MVRV shape validation passed. Full upstream parity flagged 5,716 historical market-cap differences, all reproducible before the refresh, with a maximum relative difference of 0.00272%. All ratios and both fields in all 12 new rows matched CoinMetrics. Historical rows were retained.
- The BTC heatmap diagnostic measured the simulated terminal median against the analytic median at 30, 90, 180, and 365 days. At 25,000 simulations, the largest absolute log gaps were 0.45% at the August 17 replay origin, 2.44% on November 5, and 1.28% on November 17. The path resamples contiguous blocks of mean-centered shocks, whose sampled endpoint median can move with the residual distribution. The 1% regression assertion now names and uses its August replay scenario. Separate prefix and navigation tests still run against the latest bundle. The optional date-keyed trace's persistence regression likewise uses the original August replay instead of the moving bundle tail.
- The deployment check also removed the UI guard's runtime dependency on ripgrep and fixed the gold tests to check actual covered GLD sessions and the frozen 365-day ridge scenario. `npm test` passed all 270 tests and `npm run build` passed. These test and guard changes affect validation only.

## Decision

**Rejected.** The 14-day effect was too small and unstable. Longer horizons lost accuracy and two also lost calibration. Keep the shipped BTC model. If research continues, use a prospectively frozen comparison with persistence at 14 and 30 days. For the heatmap, pre-register an origin-based test of median centering with calibration and path-dependence gates before changing simulation behavior.
