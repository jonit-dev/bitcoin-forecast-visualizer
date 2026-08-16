import rawSnapshot from '../data/sp500-crisis-model.json';

export type CrisisRiskZone = 'NORMAL' | 'WATCH' | 'HIGH';

type Probability = number;

interface CrisisThresholds {
  watch: Probability;
  high: Probability;
}

interface CrisisCurrentScore {
  asOfDate: string;
  baseRawProbability: Probability;
  incumbentProbability: Probability;
  challengerEvaluationProbability: Probability;
  challengerDeploymentProbability: Probability;
  currentDrawdown: number;
  sp500Close: number;
  vix: number;
  riskZone: CrisisRiskZone;
  deploymentThresholds: CrisisThresholds;
  lockedThresholds: CrisisThresholds;
  note: string;
}

interface CrisisHistoryPoint {
  date: string;
  target: 0 | 1;
  rawProbability: Probability;
  incumbentProbability: Probability;
  challengerDeploymentProbability: Probability;
}

interface CrisisMetricSummary {
  average_precision: number;
  average_precision_lift: number;
  brier_score: number;
  log_loss: number;
  mean_probability: number;
  positive_rate: number;
  positives: number;
  roc_auc: number;
  rows: number;
}

interface CrisisImprovementSummary {
  average_precision_gain: number;
  average_precision_relative_gain: number;
  brier_improvement: number;
  brier_relative_reduction: number;
  log_loss_improvement: number;
  log_loss_relative_reduction: number;
  roc_auc_gain: number;
  roc_auc_relative_gain: number;
}

interface CrisisUncertaintyMetric {
  ci_95: [number, number];
  mean: number;
  median: number;
  probability_positive: Probability;
  replicates: number;
}

interface CrisisUncertainty {
  average_precision_gain: CrisisUncertaintyMetric;
  brier_improvement: CrisisUncertaintyMetric;
  log_loss_improvement: CrisisUncertaintyMetric;
  roc_auc_gain: CrisisUncertaintyMetric;
  method: {
    block: string;
    random_state: number;
    years: number[];
  };
}

interface CrisisHoldoutComparison {
  period: string;
  incumbent: CrisisMetricSummary;
  challenger: CrisisMetricSummary;
  improvement: CrisisImprovementSummary;
  uncertainty: CrisisUncertainty;
}

interface CrisisSelectionProtocol {
  development_last_date: string;
  strict_cutoff: string;
  candidate_count: number;
  forward_validation_years: [number, number];
  primary_selection_metric: string;
  selected_candidate: Record<string, unknown>;
  selected_development_metrics: Record<string, number>;
}

interface CrisisRiskSnapshot {
  schemaVersion: 1;
  source: {
    archive: string;
    archiveDate: string;
    snapshotDate: string;
    comparisonArtifact: string;
    oosArtifact: string;
  };
  runtime: {
    mode: 'shadow';
    verdict: 'context-only';
    promotionStatus: 'not-promoted';
    promotionBlocker: string;
  };
  targetDefinition: string;
  currentScore: CrisisCurrentScore;
  selectionProtocol: CrisisSelectionProtocol;
  holdout: CrisisHoldoutComparison;
  events: {
    count: number;
    incumbent_high_hits: number;
    challenger_high_hits: number;
  };
  oosHistory: CrisisHistoryPoint[];
  knownLimitations: string[];
}

export interface CrisisRiskAssessment {
  snapshot: CrisisRiskSnapshot;
  score: CrisisCurrentScore;
  zone: CrisisRiskZone;
  quoteDate: string;
  isStale: boolean;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid crisis snapshot: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid crisis snapshot: ${label}.${key} must be a non-empty string`);
  }
  return value;
}

function requiredFiniteNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid crisis snapshot: ${label}.${key} must be finite`);
  }
  return value;
}

function requiredInteger(record: Record<string, unknown>, key: string, label: string): number {
  const value = requiredFiniteNumber(record, key, label);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid crisis snapshot: ${label}.${key} must be an integer`);
  }
  return value;
}

function requiredProbability(record: Record<string, unknown>, key: string, label: string): Probability {
  const value = requiredFiniteNumber(record, key, label);
  if (value < 0 || value > 1) {
    throw new Error(`Invalid crisis snapshot: ${label}.${key} must be in [0, 1]`);
  }
  return value;
}

function requiredDate(record: Record<string, unknown>, key: string, label: string): string {
  const value = requiredString(record, key, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid crisis snapshot: ${label}.${key} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid crisis snapshot: ${label}.${key} must be a real date`);
  }
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`Invalid crisis snapshot: ${label} must be a non-empty string array`);
  }
  return value as string[];
}

function parseThresholds(value: unknown, label: string): CrisisThresholds {
  const record = asRecord(value, label);
  const watch = requiredProbability(record, 'watch', label);
  const high = requiredProbability(record, 'high', label);
  if (watch >= high) {
    throw new Error(`Invalid crisis snapshot: ${label} must increase from WATCH to HIGH`);
  }
  return { watch, high };
}

function classifyZone(probability: Probability, thresholds: CrisisThresholds): CrisisRiskZone {
  if (probability >= thresholds.high) return 'HIGH';
  if (probability >= thresholds.watch) return 'WATCH';
  return 'NORMAL';
}

function parseCurrentScore(value: unknown): CrisisCurrentScore {
  const record = asRecord(value, 'currentScore');
  const asOfDate = requiredDate(record, 'asOfDate', 'currentScore');
  const baseRawProbability = requiredProbability(record, 'baseRawProbability', 'currentScore');
  const incumbentProbability = requiredProbability(record, 'incumbentProbability', 'currentScore');
  const challengerEvaluationProbability = requiredProbability(record, 'challengerEvaluationProbability', 'currentScore');
  const challengerDeploymentProbability = requiredProbability(record, 'challengerDeploymentProbability', 'currentScore');
  const deploymentThresholds = parseThresholds(record.deploymentThresholds, 'currentScore.deploymentThresholds');
  const lockedThresholds = parseThresholds(record.lockedThresholds, 'currentScore.lockedThresholds');
  const riskZone = requiredString(record, 'riskZone', 'currentScore');
  if (!['NORMAL', 'WATCH', 'HIGH'].includes(riskZone)) {
    throw new Error('Invalid crisis snapshot: currentScore.riskZone is not a known zone');
  }
  if (classifyZone(challengerDeploymentProbability, deploymentThresholds) !== riskZone) {
    throw new Error('Invalid crisis snapshot: currentScore.riskZone does not match deployment thresholds');
  }
  return {
    asOfDate,
    baseRawProbability,
    incumbentProbability,
    challengerEvaluationProbability,
    challengerDeploymentProbability,
    currentDrawdown: requiredFiniteNumber(record, 'currentDrawdown', 'currentScore'),
    sp500Close: requiredFiniteNumber(record, 'sp500Close', 'currentScore'),
    vix: requiredFiniteNumber(record, 'vix', 'currentScore'),
    riskZone: riskZone as CrisisRiskZone,
    deploymentThresholds,
    lockedThresholds,
    note: requiredString(record, 'note', 'currentScore'),
  };
}

function parseHistory(value: unknown): CrisisHistoryPoint[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Invalid crisis snapshot: oosHistory must not be empty');
  }
  let previousDate = '';
  return value.map((item, index) => {
    const record = asRecord(item, `oosHistory[${index}]`);
    const date = requiredDate(record, 'date', `oosHistory[${index}]`);
    if (date <= previousDate) {
      throw new Error('Invalid crisis snapshot: oosHistory must be strictly date ordered');
    }
    previousDate = date;
    const target = requiredInteger(record, 'target', `oosHistory[${index}]`);
    if (target !== 0 && target !== 1) {
      throw new Error(`Invalid crisis snapshot: oosHistory[${index}].target must be 0 or 1`);
    }
    return {
      date,
      target: target as 0 | 1,
      rawProbability: requiredProbability(record, 'rawProbability', `oosHistory[${index}]`),
      incumbentProbability: requiredProbability(record, 'incumbentProbability', `oosHistory[${index}]`),
      challengerDeploymentProbability: requiredProbability(record, 'challengerDeploymentProbability', `oosHistory[${index}]`),
    };
  });
}

const METRIC_KEYS = ['average_precision', 'average_precision_lift', 'brier_score', 'log_loss', 'mean_probability', 'positive_rate', 'positives', 'roc_auc', 'rows'] as const;
const IMPROVEMENT_KEYS = ['average_precision_gain', 'average_precision_relative_gain', 'brier_improvement', 'brier_relative_reduction', 'log_loss_improvement', 'log_loss_relative_reduction', 'roc_auc_gain', 'roc_auc_relative_gain'] as const;
const UNCERTAINTY_KEYS = ['average_precision_gain', 'brier_improvement', 'log_loss_improvement', 'roc_auc_gain'] as const;

function parseMetricSummary(value: unknown, label: string): CrisisMetricSummary {
  const record = asRecord(value, label);
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, requiredFiniteNumber(record, key, label)])) as unknown as CrisisMetricSummary;
}

function parseImprovementSummary(value: unknown, label: string): CrisisImprovementSummary {
  const record = asRecord(value, label);
  return Object.fromEntries(IMPROVEMENT_KEYS.map((key) => [key, requiredFiniteNumber(record, key, label)])) as unknown as CrisisImprovementSummary;
}

function parseUncertaintyMetric(value: unknown, label: string): CrisisUncertaintyMetric {
  const record = asRecord(value, label);
  const interval = record.ci_95;
  if (!Array.isArray(interval) || interval.length !== 2 || interval.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`Invalid crisis snapshot: ${label}.ci_95 must contain two finite values`);
  }
  const ci95 = interval as [number, number];
  if (ci95[0] > ci95[1]) throw new Error(`Invalid crisis snapshot: ${label}.ci_95 is reversed`);
  const probabilityPositive = requiredProbability(record, 'probability_positive', label);
  const replicates = requiredInteger(record, 'replicates', label);
  if (replicates < 1) throw new Error(`Invalid crisis snapshot: ${label}.replicates must be positive`);
  return {
    ci_95: ci95,
    mean: requiredFiniteNumber(record, 'mean', label),
    median: requiredFiniteNumber(record, 'median', label),
    probability_positive: probabilityPositive,
    replicates,
  };
}

function parseHoldout(value: unknown): CrisisHoldoutComparison {
  const record = asRecord(value, 'holdout');
  const uncertaintyRecord = asRecord(record.uncertainty, 'holdout.uncertainty');
  const methodRecord = asRecord(uncertaintyRecord.method, 'holdout.uncertainty.method');
  const yearsValue = methodRecord.years;
  if (!Array.isArray(yearsValue) || yearsValue.length === 0 || yearsValue.some((year) => typeof year !== 'number' || !Number.isInteger(year))) {
    throw new Error('Invalid crisis snapshot: holdout uncertainty years are invalid');
  }
  return {
    period: requiredString(record, 'period', 'holdout'),
    incumbent: parseMetricSummary(record.incumbent, 'holdout.incumbent'),
    challenger: parseMetricSummary(record.challenger, 'holdout.challenger'),
    improvement: parseImprovementSummary(record.improvement, 'holdout.improvement'),
    uncertainty: {
      ...Object.fromEntries(UNCERTAINTY_KEYS.map((key) => [key, parseUncertaintyMetric(uncertaintyRecord[key], `holdout.uncertainty.${key}`)])),
      method: {
        block: requiredString(methodRecord, 'block', 'holdout.uncertainty.method'),
        random_state: requiredInteger(methodRecord, 'random_state', 'holdout.uncertainty.method'),
        years: yearsValue as number[],
      },
    } as CrisisUncertainty,
  };
}

function validateSnapshot(value: unknown): CrisisRiskSnapshot {
  const root = asRecord(value, 'root');
  if (root.schemaVersion !== 1) throw new Error('Invalid crisis snapshot: unsupported schemaVersion');
  const source = asRecord(root.source, 'source');
  const runtime = asRecord(root.runtime, 'runtime');
  const targetDefinition = requiredString(root, 'targetDefinition', 'root');
  const sourceDate = requiredString(source, 'archiveDate', 'source');
  const snapshotDate = requiredString(source, 'snapshotDate', 'source');
  if (sourceDate !== snapshotDate) throw new Error('Invalid crisis snapshot: source dates disagree');
  if (requiredString(source, 'archive', 'source') !== 'sp500-crisis-model-v2.zip') throw new Error('Invalid crisis snapshot: unexpected source archive');
  requiredDate({ date: sourceDate }, 'date', 'source.archiveDate');
  requiredDate({ date: snapshotDate }, 'date', 'source.snapshotDate');
  if (requiredString(runtime, 'mode', 'runtime') !== 'shadow' || requiredString(runtime, 'verdict', 'runtime') !== 'context-only' || requiredString(runtime, 'promotionStatus', 'runtime') !== 'not-promoted') {
    throw new Error('Invalid crisis snapshot: runtime must remain shadow and context-only');
  }
  const selection = asRecord(root.selectionProtocol, 'selectionProtocol');
  const forwardYears = selection.forward_validation_years;
  if (!Array.isArray(forwardYears) || forwardYears.length !== 2 || forwardYears.some((year) => typeof year !== 'number' || !Number.isInteger(year))) {
    throw new Error('Invalid crisis snapshot: selection forward_validation_years are invalid');
  }
  const developmentMetrics = asRecord(selection.selected_development_metrics, 'selectionProtocol.selected_development_metrics');
  for (const key of Object.keys(developmentMetrics)) requiredFiniteNumber(developmentMetrics, key, 'selectionProtocol.selected_development_metrics');
  const events = asRecord(root.events, 'events');
  const eventValues = {
    count: requiredInteger(events, 'count', 'events'),
    incumbent_high_hits: requiredInteger(events, 'incumbent_high_hits', 'events'),
    challenger_high_hits: requiredInteger(events, 'challenger_high_hits', 'events'),
  };
  if (eventValues.count < 1 || eventValues.incumbent_high_hits < 0 || eventValues.challenger_high_hits < 0) throw new Error('Invalid crisis snapshot: events are invalid');
  const limitations = requiredStringArray(root.knownLimitations, 'knownLimitations');
  return {
    schemaVersion: 1,
    source: {
      archive: requiredString(source, 'archive', 'source'),
      archiveDate: sourceDate,
      snapshotDate,
      comparisonArtifact: requiredString(source, 'comparisonArtifact', 'source'),
      oosArtifact: requiredString(source, 'oosArtifact', 'source'),
    },
    runtime: {
      mode: 'shadow',
      verdict: 'context-only',
      promotionStatus: 'not-promoted',
      promotionBlocker: requiredString(runtime, 'promotionBlocker', 'runtime'),
    },
    targetDefinition,
    currentScore: parseCurrentScore(root.currentScore),
    selectionProtocol: {
      development_last_date: requiredString(selection, 'development_last_date', 'selectionProtocol'),
      strict_cutoff: requiredString(selection, 'strict_cutoff', 'selectionProtocol'),
      candidate_count: requiredInteger(selection, 'candidate_count', 'selectionProtocol'),
      forward_validation_years: forwardYears as [number, number],
      primary_selection_metric: requiredString(selection, 'primary_selection_metric', 'selectionProtocol'),
      selected_candidate: asRecord(selection.selected_candidate, 'selectionProtocol.selected_candidate'),
      selected_development_metrics: Object.fromEntries(Object.entries(developmentMetrics).map(([key, value]) => [key, Number(value)])),
    },
    holdout: parseHoldout(root.holdout),
    events: eventValues,
    oosHistory: parseHistory(root.oosHistory),
    knownLimitations: limitations,
  };
}

const validatedSnapshot = validateSnapshot(rawSnapshot);

const sp500CrisisModel: CrisisRiskSnapshot = validatedSnapshot;

export function getCurrentCrisisRisk(quoteDate: string): CrisisRiskAssessment {
  requiredDate({ quoteDate }, 'quoteDate', 'current risk');
  const score = sp500CrisisModel.currentScore;
  return {
    snapshot: sp500CrisisModel,
    score,
    zone: classifyZone(score.challengerDeploymentProbability, score.deploymentThresholds),
    quoteDate,
    isStale: quoteDate > score.asOfDate,
  };
}
