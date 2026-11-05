import { describe, expect, it } from 'vitest';
import { loadMarketData } from '../api';
import {
  buildGenericModelInputs,
  buildMarketForecastSummary,
  genericHeatmapDriftIncrements,
  genericHeatmapLogVarianceIncrements,
} from '../marketForecast';
import { computeProbabilityForecast, heatmapIntervalLogVariances, simulateHeatmapPrices } from '../data';
import { computePowerLawInterval } from '../forecastInterval';
import { POWER_LAW_MEAN_REVERSION_TAU_DAYS } from '../powerLaw';

const Z95 = 1.6448536269514722;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const gold = loadMarketData('gold');
const sp500 = loadMarketData('sp500');
const lastClose = gold.ohlcv.at(-1)!.close;

describe('heatmap distribution agrees with its summary', () => {
  it('should centre the gold heatmap on the declared median, not one Ito term below it', () => {
    for (const horizon of [30, 365, 3650]) {
      const { modelInputs } = buildGenericModelInputs('gold', gold.ohlcv, horizon);
      const simulatedMedian = lastClose * Math.exp(sum(genericHeatmapDriftIncrements(modelInputs, horizon)));
      const summary = buildMarketForecastSummary('gold', gold, horizon, Z95).probabilityForecast!;

      expect(simulatedMedian).toBeCloseTo(summary.median, 6);
      const sigma = Math.sqrt(sum(genericHeatmapLogVarianceIncrements(modelInputs, horizon)));
      expect(summary.q95).toBeCloseTo(summary.median * Math.exp(Z95 * sigma), 6);
    }
  });

  it('should give the S&P 500 heatmap the session term-structure variance the summary declares', () => {
    for (const horizon of [180, 3650]) {
      const { modelInputs } = buildGenericModelInputs('sp500', sp500.ohlcv, horizon, sp500.impliedVol);
      const simulatedVariance = sum(genericHeatmapLogVarianceIncrements(modelInputs, horizon));
      const projectionVariance = modelInputs.logVarianceByDay![horizon];

      expect(simulatedVariance).toBeCloseTo(projectionVariance, 12);

      const summary = buildMarketForecastSummary('sp500', sp500, horizon, Z95).probabilityForecast!;
      expect(summary.q95 / summary.median).toBeCloseTo(Math.exp(Z95 * Math.sqrt(projectionVariance)), 9);
    }
  });

  it('should give the BTC heatmap the width its own interval reports at every supported horizon', () => {
    const btc = loadMarketData('btc');
    const btcLastClose = btc.ohlcv.at(-1)!.close;
    const decaySquared = Math.exp(-2 / POWER_LAW_MEAN_REVERSION_TAU_DAYS);

    for (const horizon of [365, 1825, 3650]) {
      const summary = computeProbabilityForecast(btc.ohlcv, horizon)!;
      const interval = computePowerLawInterval({ ohlcv: btc.ohlcv, horizonDays: horizon, median: summary.median, currentPrice: btcLastClose })!;

      // Exact: the heatmap's innovation variances propagate to the interval's terminal variance.
      const variances = heatmapIntervalLogVariances(btc.ohlcv, horizon);
      let propagated = 0;
      for (let day = 1; day <= horizon; day++) {
        propagated = propagated * decaySquared + Math.max(0, variances[day] - decaySquared * variances[day - 1]);
      }
      expect(Math.sqrt(propagated)).toBeCloseTo(interval.sigma, 9);

      // Sampled: fixed seed, 12% tolerance on the terminal log width.
      const simulation = simulateHeatmapPrices(btc.ohlcv, horizon, 2_000, 120)!;
      const index = simulation.sampledDays.indexOf(horizon);
      const terminal = Array.from(
        { length: simulation.numSimulations },
        (_, draw) => simulation.prices[draw * simulation.sampledDays.length + index]
      ).sort((left, right) => left - right);
      const quantile = (q: number) => terminal[Math.floor(q * (terminal.length - 1))];
      const sampledLogWidth = (Math.log(quantile(0.95)) - Math.log(quantile(0.05))) / 2;
      expect(Math.abs(sampledLogWidth / (Z95 * interval.sigma) - 1)).toBeLessThan(0.12);
    }
  }, 60_000);
});
