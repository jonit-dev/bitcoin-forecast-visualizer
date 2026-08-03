export interface FredMacroRow {
  date: string;
  availableAfter?: string;
  metrics: Record<string, number>;
  observedDates?: Record<string, string>;
  [key: string]: unknown;
}

export interface MacroRowSelection {
  row: FredMacroRow;
  rowIndex: number;
}

export interface FredMacroSignal {
  rowDate: string;
  availableAfter: string;
  rowIndex: number;
  stressComposite: number | null;
  liquidityComposite: number | null;
  stressCompositeChange30d: number | null;
  stressShockZ30d: number | null;
  components: Record<string, number | null>;
}

const DEFAULT_Z_LOOKBACK = 252;
const DEFAULT_MINIMUM_OBSERVATIONS = 30;
const MS_PER_DAY = 86400000;

export function selectLatestAvailableMacroRow(rows: FredMacroRow[], originDate: string): MacroRowSelection | null {
  const originTime = dateTime(originDate);
  let selected: MacroRowSelection | null = null;
  rows.forEach((row, rowIndex) => {
    const availableAfter = row.availableAfter ?? `${row.date}T00:00:00.000Z`;
    if (dateTime(row.date) <= originTime && dateTime(availableAfter) <= originTime) {
      if (!selected || dateTime(row.date) > dateTime(selected.row.date)) selected = { row, rowIndex };
    }
  });
  return selected;
}

export const selectPointInTimeMacroRow = selectLatestAvailableMacroRow;

export function isMacroRowAvailable(row: FredMacroRow, originDate: string): boolean {
  const selected = selectLatestAvailableMacroRow([row], originDate);
  return selected !== null;
}

export function priorOnlyZScore(
  values: Array<number | null | undefined>,
  currentIndex: number,
  lookback = DEFAULT_Z_LOOKBACK,
  minimumObservations = 2
): number | null {
  const start = Math.max(0, currentIndex - lookback);
  const prior = values.slice(start, currentIndex).filter(isFiniteNumber);
  const current = values[currentIndex];
  if (prior.length < minimumObservations || !Number.isFinite(current)) return null;
  const mean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  const variance = prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / prior.length;
  const standardDeviation = Math.sqrt(variance);
  return standardDeviation > 0 ? (current - mean) / standardDeviation : null;
}

export function rollingPriorZScore(
  rows: FredMacroRow[],
  metric: string,
  currentIndex: number,
  lookback = DEFAULT_Z_LOOKBACK,
  minimumObservations = DEFAULT_MINIMUM_OBSERVATIONS
): number | null {
  return priorOnlyZScore(
    rows.map(row => row.metrics?.[metric]),
    currentIndex,
    lookback,
    minimumObservations
  );
}

export function buildMacroSignalSeries(rows: FredMacroRow[]): Array<FredMacroSignal | null> {
  const signals: Array<FredMacroSignal | null> = Array(rows.length).fill(null);
  const metricValues = new Map<string, Array<number | undefined>>();
  const rollingZ = (metric: string, currentIndex: number): number | null => {
    let values = metricValues.get(metric);
    if (!values) {
      values = rows.map(row => row.metrics?.[metric]);
      metricValues.set(metric, values);
    }
    return priorOnlyZScore(values, currentIndex, DEFAULT_Z_LOOKBACK, DEFAULT_MINIMUM_OBSERVATIONS);
  };
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    signals[rowIndex] = buildSignalForRow(rows, rowIndex, signals, rollingZ);
  }
  return signals;
}

export const buildPointInTimeMacroSignals = buildMacroSignalSeries;

export function buildMacroSignalAtOrigin(
  rows: FredMacroRow[],
  originDate: string,
  signalSeries = buildMacroSignalSeries(rows)
): FredMacroSignal | null {
  const selection = selectLatestAvailableMacroRow(rows, originDate);
  if (!selection) return null;
  const signal = signalSeries[selection.rowIndex];
  if (!signal) return null;
  assertPointInTimeMacroSignal(signal, originDate);
  return signal;
}

export const getMacroSignalAtOrigin = buildMacroSignalAtOrigin;

export function assertPointInTimeMacroSignal(signal: FredMacroSignal, originDate: string): void {
  if (dateTime(signal.rowDate) > dateTime(originDate) || dateTime(signal.availableAfter) > dateTime(originDate)) {
    throw new Error(`Point-in-time macro signal ${signal.rowDate} is unavailable at origin ${originDate}.`);
  }
}

function buildSignalForRow(
  rows: FredMacroRow[],
  rowIndex: number,
  priorSignals: Array<FredMacroSignal | null>,
  rollingZ: (metric: string, currentIndex: number) => number | null
): FredMacroSignal | null {
  const row = rows[rowIndex];
  const availableAfter = row.availableAfter ?? `${row.date}T00:00:00.000Z`;
  const metrics = row.metrics ?? {};
  const z = (metricNames: string[], sign = 1): number | null => {
    const metric = metricNames.find(name => Number.isFinite(metrics[name]));
    if (!metric) return null;
    const score = rollingZ(metric, rowIndex);
    return Number.isFinite(score) ? score * sign : null;
  };

  const stressComponents = {
    creditSpreadProxy: z(['baaMinusFedFundsCreditSpread', 'highYieldSpread']),
    nfci: z(['nfci']),
    vix: z(['vix']),
    baaSpread: z(['baaSpread']),
    dollarMomentum: z(['dollarMomentum30d', 'dollarMomentum']),
    invertedYieldCurve: z(['yieldCurveInversion'], 1),
  };
  if (stressComponents.invertedYieldCurve === null && Number.isFinite(metrics.yieldCurve10y2y)) {
    stressComponents.invertedYieldCurve = z(['yieldCurve10y2y'], -1);
  }

  const liquidityComponents = {
    fedBalanceSheetGrowth: z(['fedBalanceSheetChange13w', 'fedBalanceSheetGrowth13w']),
    m2Growth: z(['m2Change26w', 'm2Growth26w']),
    fedFundsChange: z(['fedFundsChange13w'], -1),
    yieldCurveChange: z(['yieldCurveChange30d']),
    dollarMomentum: z(['dollarMomentum30d', 'dollarMomentum'], -1),
  };
  const stressComposite = finiteMean(Object.values(stressComponents));
  const liquidityComposite = finiteMean(Object.values(liquidityComponents));
  const priorSignal = findSignalAtOrBefore(priorSignals, rows, rowIndex, addUtcDays(row.date, -30));
  const stressCompositeChange30d = stressComposite !== null && priorSignal?.stressComposite !== null && priorSignal?.stressComposite !== undefined
    ? stressComposite - priorSignal.stressComposite
    : null;
  const priorShockValues = priorSignals
    .slice(0, rowIndex)
    .map(signal => signal?.stressCompositeChange30d ?? null);
  const shockIndex = priorShockValues.length;
  const shockValues = [...priorShockValues, stressCompositeChange30d];
  const stressShockZ30d = stressCompositeChange30d === null
    ? null
    : priorOnlyZScore(shockValues, shockIndex, DEFAULT_Z_LOOKBACK, DEFAULT_MINIMUM_OBSERVATIONS);

  return {
    rowDate: row.date,
    availableAfter,
    rowIndex,
    stressComposite,
    liquidityComposite,
    stressCompositeChange30d,
    stressShockZ30d,
    components: {
      ...stressComponents,
      ...liquidityComponents,
    },
  };
}

function findSignalAtOrBefore(
  signals: Array<FredMacroSignal | null>,
  rows: FredMacroRow[],
  currentIndex: number,
  targetDate: string
): FredMacroSignal | null {
  for (let index = currentIndex - 1; index >= 0; index--) {
    if (rows[index].date <= targetDate && signals[index]) return signals[index];
  }
  return null;
}

function finiteMean(values: Array<number | null>): number | null {
  const finite = values.filter(isFiniteNumber);
  return finite.length >= 3 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return Number.isFinite(value);
}

function dateTime(value: string): number {
  const timestamp = Date.parse(value.includes('T') ? value : `${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function addUtcDays(date: string, days: number): string {
  return new Date(dateTime(date) + days * MS_PER_DAY).toISOString().split('T')[0];
}
