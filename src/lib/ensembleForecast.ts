import { ENSEMBLE_CONFIG } from './modelConfig';
import type { ForecastDistribution } from './backtestMetrics';
import type { RegimeClassification } from './regimeModel';
import type { TailRiskFlag } from './tailRisk';

export interface EnsembleForecastResult {
  median: number;
  enabled: boolean;
  mode: 'powerlaw-only' | 'regime-ensemble';
  reason: string;
  regime?: RegimeClassification;
  tailRisk?: TailRiskFlag;
}

export function combineForecastWithRegime(
  baselineMedian: number,
  regime: RegimeClassification | null,
  tailRisk: TailRiskFlag | null
): EnsembleForecastResult {
  if (!ENSEMBLE_CONFIG.defaultEnabled || !regime) {
    return {
      median: baselineMedian,
      enabled: false,
      mode: 'powerlaw-only',
      reason: ENSEMBLE_CONFIG.enablementReason,
      regime: regime ?? undefined,
      tailRisk: tailRisk ?? undefined,
    };
  }

  return {
    median: baselineMedian,
    enabled: true,
    mode: 'regime-ensemble',
    reason: 'Regime ensemble enabled by validation gate.',
    regime,
    tailRisk: tailRisk ?? undefined,
  };
}

export function blendForecastDistributions(
  members: { id: string; forecast: ForecastDistribution | null; weight: number }[],
  intervalAnchorId = 'powerlaw-current'
): ForecastDistribution | null {
  const usable = members.filter(member =>
    member.forecast &&
    Number.isFinite(member.forecast.median) &&
    member.forecast.median > 0 &&
    Number.isFinite(member.weight) &&
    member.weight > 0
  ) as { id: string; forecast: ForecastDistribution; weight: number }[];
  const totalWeight = usable.reduce((sum, member) => sum + member.weight, 0);
  if (usable.length === 0 || totalWeight <= 0) return null;
  const median = usable.reduce((sum, member) => sum + member.forecast.median * member.weight, 0) / totalWeight;
  const anchor = usable.find(member => member.id === intervalAnchorId)?.forecast ?? usable.find(member => member.forecast.quantiles)?.forecast;
  if (!anchor?.quantiles || anchor.median <= 0) return { median };
  const scale = median / anchor.median;
  return {
    median,
    sigma: anchor.sigma ?? null,
    quantiles: Object.fromEntries(
      Object.entries(anchor.quantiles).map(([key, value]) => [key, value === undefined ? undefined : value * scale])
    ) as ForecastDistribution['quantiles'],
  };
}
