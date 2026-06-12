import reliabilitySummary from '../data/reliability-summary.json';
import sourceFreshness from '../data/source-freshness.json';
import currentRegimeSummary from '../data/current-regime-summary.json';
import powerLawStabilitySummary from '../data/powerlaw-stability-summary.json';

export interface ReliabilitySummary {
  generatedAt: string;
  reportPath: string;
  qualityGateStatus: 'PASS' | 'FAIL';
  reliabilityScore: number;
  horizonConfidence: Record<string, { powerlawError: number; naiveError: number; status: string }>;
  ensembleEnabled: boolean;
  ensembleReason: string;
}

export interface SourceFreshness {
  generatedAt: string;
  sources: Record<string, { status: string; latestDate: string | null; lagDays: number | null; required: boolean }>;
}

export interface CurrentRegimeSummary {
  generatedAt: string;
  featureDate: string | null;
  regime: {
    probabilities: Record<string, number>;
    topState: string;
    reasonCodes: string[];
    contextOnly: true;
  };
  tailRisk: {
    riskFlag: string;
    direction: string;
    drivers: string[];
    intervalMultiplierAdjustment: number;
  };
  derivativesContext?: {
    source: string;
    sourceDate: string | null;
    openInterestUSD: number | null;
    openInterestToMarketCap: number | null;
    fundingRateDailySum: number | null;
    fundingRateDailyAvg: number | null;
    leverageState: 'unknown' | 'light' | 'normal' | 'crowded';
    fundingState: 'unknown' | 'short-stress' | 'neutral' | 'long-crowded';
    insight: string;
    status: 'context-only';
  } | null;
  networkContext?: {
    source: string;
    sourceDate: string | null;
    transferCount: number | null;
    addressBalanceCount: number | null;
    activeAddressShare: number | null;
    transfersPerTransaction: number | null;
    transferActivityPercentile: number | null;
    networkState: 'unknown' | 'quiet' | 'normal' | 'busy' | 'speculative-congestion';
    insight: string;
    status: 'context-only';
  } | null;
}

export interface PowerLawStabilitySummary {
  generatedAt: string;
  reportPath: string;
  verdict: 'stable' | 'watch' | 'unstable';
  reasons: string[];
  coefficientSummary: Record<string, unknown>;
  forecastImpact: unknown[];
}

export function loadReliabilitySummary(): ReliabilitySummary {
  return reliabilitySummary as ReliabilitySummary;
}

export function loadSourceFreshness(): SourceFreshness {
  return sourceFreshness as SourceFreshness;
}

export function loadCurrentRegimeSummary(): CurrentRegimeSummary {
  return currentRegimeSummary as CurrentRegimeSummary;
}

export function loadPowerLawStabilitySummary(): PowerLawStabilitySummary {
  return powerLawStabilitySummary as PowerLawStabilitySummary;
}
