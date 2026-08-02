import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { buildTechnicalReversalSignals, type TechnicalReversalId, type TechnicalReversalSignal } from '../src/lib/technicalReversal';
import { countCrossingEpisodes, holmAdjust, nextOpenForwardLogReturn, type CrossDirection } from '../src/lib/trendReversal';

const DEVELOPMENT = { id: 'development-2018-2021', start: '2018-01-01', end: '2021-12-31' } as const;
const HOLDOUT = { id: 'historical-holdout-2022+', start: '2022-01-01', end: '9999-12-31' } as const;
const HORIZONS = [7, 14, 30, 60, 90] as const;
const PRIMARY_HORIZON = 30;
const ROUND_TRIP_COST = 0.002;
const PRACTICAL_EFFECT = 0.01;
const DIRECTION_FLOOR = -0.005;
const BOOTSTRAP_BLOCKS = [30, 60, 90] as const;
const BOOTSTRAP_ITERATIONS = 5_000;
const RANDOMIZATION_ITERATIONS = 50_000;
const SEED = 0x14d1ca70;
const DATA_PATH = join(process.cwd(), 'src', 'data', 'btc-history.json');
const PRIOR_MA_REPORT = join(process.cwd(), 'docs', 'reports', 'results', 'trend-reversal-2026-07-13T17-57-48-796Z.json');
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const rows = btcHistory as OHLCVData[];

interface TimelineRow {
  index: number;
  date: string;
  direction: CrossDirection;
  logReturn: number;
}

interface Evaluation {
  period: string;
  horizonDays: number;
  eligibleDays: number;
  events: number;
  upEvents: number;
  downEvents: number;
  distinct30DayEpisodes: number;
  unconditionalMeanLogReturn: number;
  meanSignedNetLogReturn: number | null;
  meanSignedExcessNetLogReturn: number | null;
  geometricSignedExcessReturn: number | null;
  medianSignedExcessNetLogReturn: number | null;
  winRate: number | null;
  upMeanExcessNetLogReturn: number | null;
  downMeanExcessNetLogReturn: number | null;
  nonOverlappingEventTrades: number;
  nonOverlappingMaxDrawdown: number | null;
  largestAbsoluteEventShare: number | null;
  bootstrap95ByBlock: Record<string, [number, number]> | null;
  stratifiedShiftPValue: number | null;
}

interface CandidateResult {
  id: TechnicalReversalId;
  description: string;
  development: Evaluation[];
  holdout: Evaluation[];
  primary: Evaluation;
  holdoutSubperiods: Record<string, Evaluation>;
  withinFamilyHolmPValue: number | null;
  searchHistoryHolmPValue: number | null;
  gatePassed: boolean;
  gateReasons: string[];
}

function main(): void {
  assertDatasetOrdering();
  const signals = buildTechnicalReversalSignals(rows);
  const candidateResults = signals.map(evaluateCandidate);
  const stratifiedPValues = jointYearStratifiedPValues(signals, HOLDOUT, PRIMARY_HORIZON, candidateResults.map(result => result.primary.meanSignedExcessNetLogReturn!));
  candidateResults.forEach((result, index) => { result.primary.stratifiedShiftPValue = stratifiedPValues[index]; });

  const withinFamily = holmAdjust(stratifiedPValues);
  const prior = readPriorSearchHistory();
  const globalAdjusted = holmAdjust([...prior.rawPValues, ...stratifiedPValues]);
  candidateResults.forEach((result, index) => {
    result.withinFamilyHolmPValue = withinFamily[index];
    result.searchHistoryHolmPValue = globalAdjusted[prior.rawPValues.length + index];
    finalizeGate(result);
  });

  const anyGatePassed = candidateResults.some(result => result.gatePassed);
  const anyStatisticalClue = candidateResults.some(result =>
    (result.searchHistoryHolmPValue ?? 1) < 0.05 &&
    Object.values(result.primary.bootstrap95ByBlock ?? {}).every(interval => interval[0] > 0),
  );
  const verdict = anyGatePassed ? 'historical-positive-research-only' : anyStatisticalClue ? 'needs-more-data' : 'rejected-no-confirmed-signal';
  const generatedAt = new Date().toISOString();
  const report = {
    metadata: {
      generatedAt,
      command: 'npm run backtest:indicator-reversal',
      gitCommit: gitCommit(),
      seed: SEED,
      datasetSha256: fileSha256(DATA_PATH),
      dataset: { firstDate: rows[0].date, lastDate: rows.at(-1)!.date, rowCount: rows.length },
      development: DEVELOPMENT,
      historicalHoldout: HOLDOUT,
      horizons: HORIZONS,
      primaryHorizon: PRIMARY_HORIZON,
      roundTripCost: ROUND_TRIP_COST,
      practicalEffect: PRACTICAL_EFFECT,
      directionFloor: DIRECTION_FLOOR,
      bootstrap: { iterations: BOOTSTRAP_ITERATIONS, blockLengths: BOOTSTRAP_BLOCKS },
      randomization: { iterations: RANDOMIZATION_ITERATIONS, method: 'joint within-calendar-year circular shifts with plus-one p-value' },
      multiplicity: { withinFamily: `${signals.length} new rules`, searchHistory: `${prior.ids.length + signals.length} total rules including prior MA study` },
      implementationSha256: {
        script: fileSha256(join(process.cwd(), 'scripts', 'backtest-indicator-reversal.ts')),
        indicatorLibrary: fileSha256(join(process.cwd(), 'src', 'lib', 'technicalReversal.ts')),
        eventHelpers: fileSha256(join(process.cwd(), 'src', 'lib', 'trendReversal.ts')),
      },
    },
    claim: {
      asset: 'BTC',
      target: 'direction-adjusted next-open to next-open 30-day log return after a canonical close-confirmed technical reversal event',
      currentAppBaseline: 'unchanged power-law forecast; this is a report-only event study',
      naiveBaseline: 'same-period unconditional eligible-date return, direction-adjusted and net of frozen costs',
      expectedUserVisibleBenefit: 'identify whether any canonical indicator merits reversal context in the app',
    },
    data: inspectDataQuality(),
    preregisteredEvaluation: {
      candidates: signals.map(signal => ({ id: signal.id, description: signal.description })),
      primaryMetric: 'mean signed excess 30-day log return after 20bp round-trip cost',
      secondaryMetrics: '7/14/60/90d effects, median, win rate, direction splits, episodes, non-overlap drawdown, subperiods, event influence',
      minimumEffect: PRACTICAL_EFFECT,
      confidence: '95% percentile circular moving-block intervals at 30/60/90-day blocks',
      multipleTesting: 'Holm within new family and across seven previous MA plus four new primary rules',
    },
    formulas: {
      executionReturn: 'r(t,h) = log(Open(t+h+1) / Open(t+1))',
      effect: 'D_j = mean_i[s_i * (r_i - mu_h) - 0.002]',
      bootstrap: 'resample complete daily (signal, return) tuples in circular blocks and recompute mu_h and D_j',
      randomization: 'jointly rotate the four-signal vector by an independently sampled offset inside each calendar year; p=(exceedances+1)/(50000+1)',
    },
    priorSearchHistory: prior,
    literature: [
      { title: 'Gerritsen et al. (2020), Individual coin investor behavior and trading', url: 'https://doi.org/10.1016/j.frl.2019.101263', relevance: 'Canonical BTC RSI, Bollinger, MACD and related rule definitions; mixed historical performance.' },
      { title: 'Deprez & Frömmel (2024), Simple technical trading rules in Bitcoin markets', url: 'https://doi.org/10.1016/j.iref.2024.05.003', relevance: 'Large OOS, cost-aware, multiplicity-controlled search showing time-varying and selection-sensitive evidence.' },
      { title: 'Hudson & Urquhart (2021), Technical trading and cryptocurrencies', url: 'https://doi.org/10.1007/s10479-019-03357-1', relevance: 'No Bitcoin predictability in their pure out-of-sample period despite broad in-sample evidence.' },
      { title: 'Bollinger Band rules', url: 'https://www.bollingerbands.com/bollinger-band-rules', relevance: 'Official warning that band tags are not reversal signals and outside closes can be continuation.' },
    ],
    limitations: [
      'The 2022+ family holdout is historically frozen for these indicators but is not a pristine prospective BTC-price sample.',
      'The checked-in cache is latest-revised, and recent CoinGecko opens are aggregate sampled observations rather than executable venue prices.',
      'Year-stratified shifts preserve within-year clustering and cross-indicator dependence but do not eliminate within-year regime nonstationarity.',
      'Moving-block percentile intervals are approximate for sparse, clustered events.',
      'Bearish results are statistical direction tests; borrow, funding, liquidation, and venue constraints are not modeled.',
      'Subperiod diagnostics omit signals whose target matures across the subperiod boundary.',
      'The reported HEAD commit does not contain the uncommitted experiment files; the recorded file SHA-256 hashes are the implementation provenance.',
      'Year-stratified randomization uses the global-period drift adjustment, so its p-value is an approximate alignment rank test rather than a directly centered test of D=0.',
    ],
    independentValidation: {
      status: 'completed',
      validator: 'independent statistician/skeptic role with separate Python reproduction',
      verdict: 'keep-rejected-no-confirmed-signal',
      reproduction: 'exact match on eligible days, event/up/down counts, 30-day episodes, unconditional drift, primary effects, and development effects for all four rules',
      mathReview: 'indicator formulas, prefix safety, next-open alignment, split maturity, block bootstrap, joint shifts, 11-rule Holm, and gates checked',
    },
    verdict,
    implementationAuthorized: false,
    candidates: candidateResults,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `indicator-reversal-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `indicator-reversal-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));
  console.log(`Indicator reversal verdict: ${verdict}`);
  for (const result of candidateResults) {
    console.log(`${result.id}: n=${result.primary.events} episodes=${result.primary.distinct30DayEpisodes} effect=${formatPercent(result.primary.meanSignedExcessNetLogReturn)} CI30=${formatInterval(result.primary.bootstrap95ByBlock?.['30'] ?? null)} pGlobal=${formatNumber(result.searchHistoryHolmPValue)} ${result.gatePassed ? 'PASS' : 'FAIL'}`);
  }
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function evaluateCandidate(candidate: TechnicalReversalSignal): CandidateResult {
  const development = HORIZONS.map(horizon => evaluate(candidate.signal, DEVELOPMENT, horizon, false, 0));
  const holdout = HORIZONS.map(horizon => evaluate(candidate.signal, HOLDOUT, horizon, horizon === PRIMARY_HORIZON, SEED ^ hash(candidate.id)));
  const primary = holdout.find(item => item.horizonDays === PRIMARY_HORIZON)!;
  return {
    id: candidate.id,
    description: candidate.description,
    development,
    holdout,
    primary,
    holdoutSubperiods: {
      '2022-2024': evaluate(candidate.signal, { id: '2022-2024', start: '2022-01-01', end: '2024-12-31' }, PRIMARY_HORIZON, false, 0),
      '2025+': evaluate(candidate.signal, { id: '2025+', start: '2025-01-01', end: '9999-12-31' }, PRIMARY_HORIZON, false, 0),
    },
    withinFamilyHolmPValue: null,
    searchHistoryHolmPValue: null,
    gatePassed: false,
    gateReasons: [],
  };
}

function evaluate(signal: readonly CrossDirection[], period: { id: string; start: string; end: string }, horizonDays: number, infer: boolean, seed: number): Evaluation {
  const timeline = buildTimeline(signal, period, horizonDays);
  const mu = mean(timeline.map(row => row.logReturn));
  const events = timeline.filter(row => row.direction !== 0);
  const effects = events.map(row => row.direction * (row.logReturn - mu) - ROUND_TRIP_COST);
  const rawNet = events.map(row => row.direction * row.logReturn - ROUND_TRIP_COST);
  const up = events.filter(row => row.direction === 1).map(row => row.logReturn - mu - ROUND_TRIP_COST);
  const down = events.filter(row => row.direction === -1).map(row => -(row.logReturn - mu) - ROUND_TRIP_COST);
  const nonOverlapping = nonOverlappingReturns(events, horizonDays);
  const primaryEffect = nullableMean(effects);
  return {
    period: period.id,
    horizonDays,
    eligibleDays: timeline.length,
    events: events.length,
    upEvents: up.length,
    downEvents: down.length,
    distinct30DayEpisodes: countCrossingEpisodes(events.map(event => event.date), 30),
    unconditionalMeanLogReturn: mu,
    meanSignedNetLogReturn: nullableMean(rawNet),
    meanSignedExcessNetLogReturn: primaryEffect,
    geometricSignedExcessReturn: primaryEffect === null ? null : Math.expm1(primaryEffect),
    medianSignedExcessNetLogReturn: median(effects),
    winRate: rawNet.length ? rawNet.filter(value => value > 0).length / rawNet.length : null,
    upMeanExcessNetLogReturn: nullableMean(up),
    downMeanExcessNetLogReturn: nullableMean(down),
    nonOverlappingEventTrades: nonOverlapping.length,
    nonOverlappingMaxDrawdown: nonOverlapping.length ? maximumDrawdown(nonOverlapping) : null,
    largestAbsoluteEventShare: contributionShare(effects),
    bootstrap95ByBlock: infer && events.length ? Object.fromEntries(BOOTSTRAP_BLOCKS.map((block, index) => [String(block), blockBootstrap(timeline, block, seed ^ (index + 1) * 0x9e37)])) : null,
    stratifiedShiftPValue: null,
  };
}

function buildTimeline(signal: readonly CrossDirection[], period: { start: string; end: string }, horizonDays: number): TimelineRow[] {
  const timeline: TimelineRow[] = [];
  for (let index = 0; index + horizonDays + 1 < rows.length; index++) {
    if (rows[index].date < period.start || rows[index].date > period.end) continue;
    const logReturn = nextOpenForwardLogReturn(rows, index, horizonDays, period.end);
    if (logReturn !== null) timeline.push({ index, date: rows[index].date, direction: signal[index], logReturn });
  }
  return timeline;
}

function blockBootstrap(timeline: readonly TimelineRow[], blockLength: number, seed: number): [number, number] {
  const rng = mulberry32(seed);
  const statistics: number[] = [];
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration++) {
    let sampled = 0;
    let returnSum = 0;
    let signedReturnSum = 0;
    let directionSum = 0;
    let eventCount = 0;
    while (sampled < timeline.length) {
      const start = Math.floor(rng() * timeline.length);
      for (let offset = 0; offset < blockLength && sampled < timeline.length; offset++, sampled++) {
        const row = timeline[(start + offset) % timeline.length];
        returnSum += row.logReturn;
        if (row.direction !== 0) {
          signedReturnSum += row.direction * row.logReturn;
          directionSum += row.direction;
          eventCount++;
        }
      }
    }
    if (eventCount) {
      const resampledMu = returnSum / timeline.length;
      statistics.push(signedReturnSum / eventCount - resampledMu * directionSum / eventCount - ROUND_TRIP_COST);
    }
  }
  statistics.sort((a, b) => a - b);
  return [quantileSorted(statistics, 0.025), quantileSorted(statistics, 0.975)];
}

function jointYearStratifiedPValues(signals: readonly TechnicalReversalSignal[], period: { start: string; end: string }, horizonDays: number, observed: readonly number[]): number[] {
  const timelines = signals.map(signal => buildTimeline(signal.signal, period, horizonDays));
  const base = timelines[0];
  if (!timelines.every(timeline => timeline.length === base.length && timeline.every((row, index) => row.date === base[index].date))) throw new Error('candidate timelines are not aligned');
  const directions = timelines.map(timeline => timeline.map(row => row.direction));
  const returns = base.map(row => row.logReturn);
  const mu = mean(returns);
  const years = new Map<string, number[]>();
  base.forEach((row, index) => { const year = row.date.slice(0, 4); (years.get(year) ?? years.set(year, []).get(year)!).push(index); });
  const eventCounts = directions.map(values => values.filter(value => value !== 0).length);
  const directionSums = directions.map(values => values.reduce((sum, value) => sum + value, 0));
  const exceedances = Array(signals.length).fill(0);
  const rng = mulberry32(SEED ^ 0x51f7a7ed);
  for (let iteration = 0; iteration < RANDOMIZATION_ITERATIONS; iteration++) {
    const signedSums = Array(signals.length).fill(0);
    for (const indices of years.values()) {
      const shift = Math.floor(rng() * indices.length);
      for (let position = 0; position < indices.length; position++) {
        const returnIndex = indices[position];
        const signalIndex = indices[(position + shift) % indices.length];
        for (let candidate = 0; candidate < signals.length; candidate++) signedSums[candidate] += directions[candidate][signalIndex] * returns[returnIndex];
      }
    }
    for (let candidate = 0; candidate < signals.length; candidate++) {
      const statistic = signedSums[candidate] / eventCounts[candidate] - mu * directionSums[candidate] / eventCounts[candidate] - ROUND_TRIP_COST;
      if (statistic >= observed[candidate]) exceedances[candidate]++;
    }
  }
  return exceedances.map(count => (count + 1) / (RANDOMIZATION_ITERATIONS + 1));
}

function finalizeGate(result: CandidateResult): void {
  const development = result.development.find(item => item.horizonDays === PRIMARY_HORIZON)!;
  const primary = result.primary;
  const reasons: string[] = [];
  if (primary.events < 30) reasons.push(`holdout events ${primary.events} < 30`);
  if (primary.distinct30DayEpisodes < 20) reasons.push(`distinct 30-day episodes ${primary.distinct30DayEpisodes} < 20`);
  if (primary.upEvents < 10 || primary.downEvents < 10) reasons.push(`direction counts ${primary.upEvents}/${primary.downEvents} do not both reach 10`);
  if (!((development.meanSignedExcessNetLogReturn ?? -Infinity) > 0)) reasons.push('development mean effect is not positive');
  if (!((primary.meanSignedExcessNetLogReturn ?? -Infinity) >= PRACTICAL_EFFECT)) reasons.push('holdout mean effect is below 1%');
  for (const [block, interval] of Object.entries(primary.bootstrap95ByBlock ?? {})) if (!(interval[0] > 0)) reasons.push(`${block}d-block bootstrap lower bound is not positive`);
  if (!((result.searchHistoryHolmPValue ?? 1) < 0.05)) reasons.push(`search-history Holm p=${formatNumber(result.searchHistoryHolmPValue)} is not below 0.05`);
  if ((primary.upMeanExcessNetLogReturn ?? -Infinity) < DIRECTION_FLOOR || (primary.downMeanExcessNetLogReturn ?? -Infinity) < DIRECTION_FLOOR) reasons.push(`a direction effect is below ${formatPercent(DIRECTION_FLOOR)}`);
  for (const [period, evaluation] of Object.entries(result.holdoutSubperiods)) if (evaluation.events >= 5 && !((evaluation.meanSignedExcessNetLogReturn ?? -Infinity) > 0)) reasons.push(`${period} effect is not positive`);
  if ((primary.largestAbsoluteEventShare ?? Infinity) > 0.20) reasons.push('largest event exceeds 20% of absolute contribution');
  result.gateReasons = reasons;
  result.gatePassed = reasons.length === 0;
}

function readPriorSearchHistory(): { source: string; sha256: string; ids: string[]; rawPValues: number[] } {
  const report = JSON.parse(readFileSync(PRIOR_MA_REPORT, 'utf8')) as { candidates: Array<{ id: string; primary: { circularShiftPValue: number } }> };
  return { source: PRIOR_MA_REPORT, sha256: fileSha256(PRIOR_MA_REPORT), ids: report.candidates.map(candidate => candidate.id), rawPValues: report.candidates.map(candidate => candidate.primary.circularShiftPValue) };
}

function inspectDataQuality() {
  let gaps = 0;
  let duplicates = 0;
  let invalidFull = 0;
  let invalidScored = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const invalid = row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close) || row.low > row.high;
    if (invalid) { invalidFull++; if (row.date >= DEVELOPMENT.start) invalidScored++; }
    if (index > 0) {
      const difference = daysBetween(rows[index - 1].date, row.date);
      if (difference === 0) duplicates++;
      else if (difference !== 1) gaps++;
    }
  }
  return { source: DATA_PATH, frequency: 'daily UTC', rowCount: rows.length, gaps, duplicates, malformedOhlcFullHistory: invalidFull, malformedOhlcScoredPeriod: invalidScored, scoredStart: DEVELOPMENT.start, closeAvailability: 'indicator after UTC close t; execution begins at UTC open t+1' };
}

function renderMarkdown(report: any): string {
  const lines = [
    '# BTC Canonical Technical-Indicator Reversal Study', '',
    `Generated: ${report.metadata.generatedAt}`, '',
    `Decision: **${report.verdict}**. Runtime implementation authorized: **no**.`, '',
    '## Claim', '',
    `Four canonical close-confirmed indicators are tested for direction-adjusted ${PRIMARY_HORIZON}-day BTC reversal information after 20bp round-trip cost. Signals execute only from the next UTC open.`, '',
    '## Data', '',
    `Checked-in BTC OHLCV: ${report.metadata.dataset.firstDate} through ${report.metadata.dataset.lastDate}, ${report.metadata.dataset.rowCount} rows, SHA-256 \`${report.metadata.datasetSha256}\`. Scoring starts 2018-01-01; 2022+ is a frozen historical family holdout, not pristine prospective data.`, '',
    `Quality: ${report.data.gaps} gaps, ${report.data.duplicates} duplicates, ${report.data.malformedOhlcFullHistory} malformed legacy rows, ${report.data.malformedOhlcScoredPeriod} malformed scored rows.`, '',
    '## Pre-registered 30-day holdout results', '',
    '| Indicator | N | 30d episodes | Up/down | Net excess | CI block 30 | CI block 60 | CI block 90 | raw p | Holm 4 | Holm 11 | Dev | Gate |',
    '|---|---:|---:|---:|---:|---|---|---|---:|---:|---:|---:|---|',
  ];
  for (const candidate of report.candidates) {
    const dev = candidate.development.find((item: Evaluation) => item.horizonDays === PRIMARY_HORIZON)!;
    lines.push(`| ${candidate.id} | ${candidate.primary.events} | ${candidate.primary.distinct30DayEpisodes} | ${candidate.primary.upEvents}/${candidate.primary.downEvents} | ${formatPercent(candidate.primary.meanSignedExcessNetLogReturn)} | ${formatInterval(candidate.primary.bootstrap95ByBlock?.['30'] ?? null)} | ${formatInterval(candidate.primary.bootstrap95ByBlock?.['60'] ?? null)} | ${formatInterval(candidate.primary.bootstrap95ByBlock?.['90'] ?? null)} | ${formatNumber(candidate.primary.stratifiedShiftPValue)} | ${formatNumber(candidate.withinFamilyHolmPValue)} | ${formatNumber(candidate.searchHistoryHolmPValue)} | ${formatPercent(dev.meanSignedExcessNetLogReturn)} | ${candidate.gatePassed ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('', 'Positive excess means the event beat the direction-adjusted period drift after costs. The promotion p-value is Holm-adjusted across all seven prior MA rules and four new indicator rules.', '', '## Gate failures', '');
  for (const candidate of report.candidates) lines.push(`- **${candidate.id}:** ${candidate.gateReasons.length ? candidate.gateReasons.join('; ') : 'none'}.`);
  lines.push('', '## Secondary horizon diagnostics', '', '| Indicator | Period | h | N | Episodes | Excess | Win rate | Up excess | Down excess | Max DD |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const candidate of report.candidates) for (const evaluation of [...candidate.development, ...candidate.holdout]) lines.push(`| ${candidate.id} | ${evaluation.period} | ${evaluation.horizonDays} | ${evaluation.events} | ${evaluation.distinct30DayEpisodes} | ${formatPercent(evaluation.meanSignedExcessNetLogReturn)} | ${formatPercent(evaluation.winRate)} | ${formatPercent(evaluation.upMeanExcessNetLogReturn)} | ${formatPercent(evaluation.downMeanExcessNetLogReturn)} | ${formatPercent(evaluation.nonOverlappingMaxDrawdown)} |`);
  lines.push('', '## Math and leakage proof', '', '- RSI, bands, stochastic, and MACD at date `t` use only candles through the completed close at `t`.', '- Entry is `open[t+1]`; exit is `open[t+h+1]`. Targets must mature inside their evaluation period.', `- Primary effect: \`${report.formulas.effect}\`.`, `- Uncertainty uses ${BOOTSTRAP_ITERATIONS.toLocaleString()} circular moving-block samples at 30/60/90-day blocks and ${RANDOMIZATION_ITERATIONS.toLocaleString()} joint within-year shifts.`, '- The within-year null preserves signal clustering and cross-indicator dependence better than a whole-history rotation, but it remains approximate under regime change.', '', '## Research context', '', '- [Gerritsen et al.](https://doi.org/10.1016/j.frl.2019.101263) supplies canonical BTC indicator definitions but limited OOS protection.', '- [Deprez & Frömmel](https://doi.org/10.1016/j.iref.2024.05.003) shows technical-rule evidence is selection-sensitive even with costs and OOS testing.', '- [Hudson & Urquhart](https://doi.org/10.1007/s10479-019-03357-1) finds no Bitcoin predictability in their pure OOS period.', '- [John Bollinger’s rules](https://www.bollingerbands.com/bollinger-band-rules) explicitly warn that band tags are not standalone reversal signals.', '', '## Reproduction', '', `- Command: \`${report.metadata.command}\``, `- Git commit: \`${report.metadata.gitCommit}\``, `- Script SHA-256: \`${report.metadata.implementationSha256.script}\``, `- Indicator SHA-256: \`${report.metadata.implementationSha256.indicatorLibrary}\``, '- No forecast, API, UI, regime, or product behavior changed.', '');
  return `${lines.join('\n')}\n`;
}

function nonOverlappingReturns(events: readonly TimelineRow[], horizonDays: number): number[] { const selected: number[] = []; let lastExit = -Infinity; for (const event of events) { if (event.index + 1 <= lastExit) continue; selected.push(event.direction * event.logReturn - ROUND_TRIP_COST); lastExit = event.index + horizonDays + 1; } return selected; }
function maximumDrawdown(returns: readonly number[]): number { let wealth = 1; let peak = 1; let drawdown = 0; for (const value of returns) { wealth *= Math.exp(value); peak = Math.max(peak, wealth); drawdown = Math.min(drawdown, wealth / peak - 1); } return drawdown; }
function contributionShare(values: readonly number[]): number | null { if (!values.length) return null; const total = values.reduce((sum, value) => sum + Math.abs(value), 0); return total ? Math.max(...values.map(Math.abs)) / total : null; }
function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN; }
function nullableMean(values: readonly number[]): number | null { return values.length ? mean(values) : null; }
function median(values: readonly number[]): number | null { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function quantileSorted(values: readonly number[], q: number): number { const index = (values.length - 1) * q; const lower = Math.floor(index); const upper = Math.ceil(index); return values[lower] + (values[upper] - values[lower]) * (index - lower); }
function daysBetween(a: string, b: string): number { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000); }
function assertDatasetOrdering(): void { for (let index = 0; index < rows.length; index++) { const row = rows[index]; if (!(row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)) throw new Error(`non-positive BTC price at ${row.date}`); if (index > 0 && rows[index - 1].date >= row.date) throw new Error(`BTC dates not strictly increasing at ${row.date}`); } }
function fileSha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function gitCommit(): string { try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } }
function hash(value: string): number { let result = 2166136261; for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); } return result >>> 0; }
function mulberry32(seed: number): () => number { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) >>> 0; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296; }; }
function formatNumber(value: number | null): string { return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(5); }
function formatPercent(value: number | null): string { return value === null || !Number.isFinite(value) ? 'n/a' : `${(100 * value).toFixed(2)}%`; }
function formatInterval(value: [number, number] | null): string { return value ? `[${formatPercent(value[0])}, ${formatPercent(value[1])}]` : 'n/a'; }

main();
