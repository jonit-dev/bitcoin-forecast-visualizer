import { ENSEMBLE_CONFIG } from './modelConfig';
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
