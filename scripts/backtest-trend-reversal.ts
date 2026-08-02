import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import {
  countCrossingEpisodes,
  exponentialMovingAverage,
  holmAdjust,
  hysteresisCrosses,
  nextOpenForwardLogReturn,
  simpleMovingAverage,
  strictCrosses,
  type CrossDirection,
} from '../src/lib/trendReversal';

const DEVELOPMENT = { id: 'development-2018-2021', start: '2018-01-01', end: '2021-12-31' } as const;
const HOLDOUT = { id: 'historical-holdout-2022+', start: '2022-01-01', end: '9999-12-31' } as const;
const HORIZONS = [7, 14, 30, 60, 90] as const;
const PRIMARY_HORIZON = 30;
const ROUND_TRIP_COST = 0.002;
const PRACTICAL_EFFECT = 0.01;
const PRIMARY_BOOTSTRAP_ITERATIONS = 5_000;
const SEED = 0x20050e13;
const DATA_PATH = join(process.cwd(), 'src', 'data', 'btc-history.json');
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const rows = btcHistory as OHLCVData[];

type CandidateId =
  | 'close-sma50'
  | 'close-ema50'
  | 'close-sma200'
  | 'close-ema200'
  | 'sma50-sma200'
  | 'ema50-ema200'
  | 'close-sma200-band-1pct';

interface Candidate {
  id: CandidateId;
  description: string;
  signal: CrossDirection[];
}

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
  distinct14DayEpisodes: number;
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
  bootstrap95: [number, number] | null;
  circularShiftPValue: number | null;
  largestAbsoluteEventShare: number | null;
}

interface CandidateResult {
  id: CandidateId;
  description: string;
  development: Evaluation[];
  holdout: Evaluation[];
  primary: Evaluation;
  holdoutSubperiods: Record<string, Evaluation>;
  holmAdjustedPValue: number | null;
  gatePassed: boolean;
  gateReasons: string[];
}

function main(): void {
  assertDatasetOrdering();
  const closes = rows.map(row => row.close);
  const sma50 = simpleMovingAverage(closes, 50);
  const sma200 = simpleMovingAverage(closes, 200);
  const ema50 = exponentialMovingAverage(closes, 50);
  const ema200 = exponentialMovingAverage(closes, 200);
  const candidates: Candidate[] = [
    { id: 'close-sma50', description: 'Close crossing its trailing 50-day SMA.', signal: strictCrosses(closes, sma50) },
    { id: 'close-ema50', description: 'Close crossing its recursive 50-day EMA.', signal: strictCrosses(closes, ema50) },
    { id: 'close-sma200', description: 'Close crossing its trailing 200-day SMA.', signal: strictCrosses(closes, sma200) },
    { id: 'close-ema200', description: 'Close crossing its recursive 200-day EMA.', signal: strictCrosses(closes, ema200) },
    { id: 'sma50-sma200', description: '50-day SMA crossing the 200-day SMA (golden/death cross).', signal: strictCrosses(sma50, sma200) },
    { id: 'ema50-ema200', description: '50-day EMA crossing the 200-day EMA.', signal: strictCrosses(ema50, ema200) },
    { id: 'close-sma200-band-1pct', description: 'Close/SMA200 transition through a fixed 1% hysteresis band.', signal: hysteresisCrosses(closes, sma200, 0.01) },
  ];

  const candidateResults = candidates.map(candidate => evaluateCandidate(candidate));
  const adjusted = holmAdjust(candidateResults.map(result => result.primary.circularShiftPValue ?? 1));
  candidateResults.forEach((result, index) => finalizeGate(result, adjusted[index]));

  const anyGatePassed = candidateResults.some(result => result.gatePassed);
  const anyStatisticalClue = candidateResults.some(result =>
    (result.holmAdjustedPValue ?? 1) < 0.05 && (result.primary.bootstrap95?.[0] ?? -Infinity) > 0,
  );
  const verdict = anyGatePassed
    ? 'historical-positive-research-only'
    : anyStatisticalClue
      ? 'needs-more-data'
      : 'rejected-no-confirmed-signal';
  const generatedAt = new Date().toISOString();
  const dataQuality = inspectDataQuality();
  const report = {
    metadata: {
      generatedAt,
      command: 'npm run backtest:trend-reversal',
      gitCommit: gitCommit(),
      seed: SEED,
      datasetSha256: createHash('sha256').update(readFileSync(DATA_PATH)).digest('hex'),
      dataset: { firstDate: rows[0]?.date, lastDate: rows.at(-1)?.date, rowCount: rows.length },
      development: DEVELOPMENT,
      historicalHoldout: HOLDOUT,
      horizons: HORIZONS,
      primaryHorizon: PRIMARY_HORIZON,
      roundTripCost: ROUND_TRIP_COST,
      practicalEffect: PRACTICAL_EFFECT,
      bootstrapIterations: PRIMARY_BOOTSTRAP_ITERATIONS,
      circularShiftProtocol: 'exact enumeration of every nonzero shift within each evaluation period',
      multiplicity: `Holm across ${candidates.length} frozen candidate rules at ${PRIMARY_HORIZON}d`,
      implementationSha256: {
        script: fileSha256(join(process.cwd(), 'scripts', 'backtest-trend-reversal.ts')),
        signalLibrary: fileSha256(join(process.cwd(), 'src', 'lib', 'trendReversal.ts')),
      },
    },
    claim: {
      asset: 'BTC',
      target: 'direction-adjusted next-open to next-open forward log return after a close-confirmed crossover',
      candidateChange: 'none; report-only crossover event study',
      expectedUserBenefit: 'evidence on whether an MA cross is useful reversal context rather than chart folklore',
    },
    dataQuality,
    formulas: {
      sma: 'SMA_n(t) = (1/n) * sum_{j=0}^{n-1} Close(t-j)',
      ema: 'EMA_n(t) = alpha*Close(t) + (1-alpha)*EMA_n(t-1), alpha=2/(n+1), seeded by the first observed close',
      event: 'up if spread(t-1)<=0 and spread(t)>0; down if spread(t-1)>=0 and spread(t)<0',
      executionReturn: 'r(t,h) = log(Open(t+h+1) / Open(t+1))',
      primaryEffect: 'D_j = mean_i[s_i * (r_i - mu_h) - 0.002], where mu_h is the period-wide eligible-date mean r',
      null: 'H0: crossover timing is independent of future return alignment; practical gate additionally requires D_j >= 0.01',
      bootstrap: 'percentile interval from circular moving blocks of complete daily (signal, return) tuples; block length=h',
      randomization: 'one-sided exact enumeration of every nonzero circular shift of the complete signal sequence against the fixed forward-return sequence',
    },
    literature: [
      { title: 'Brock, Lakonishok & LeBaron (1992), Simple Technical Trading Rules', url: 'https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1992.tb04681.x', relevance: 'Canonical price/SMA200 rule and 1% band.' },
      { title: 'Detzel et al. (2021), Bitcoin: Learning and Predictability via Technical Analysis', url: 'https://onlinelibrary.wiley.com/doi/10.1111/fima.12310', relevance: 'Out-of-sample BTC evidence for price/MA trend ratios over 1-20 weeks.' },
      { title: 'Hudson & Urquhart (2021), Technical trading and cryptocurrencies', url: 'https://link.springer.com/article/10.1007/s10479-019-03357-1', relevance: 'Pure out-of-sample BTC rule profitability is not supported in their test.' },
      { title: 'White (2000), A Reality Check for Data Snooping', url: 'https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152', relevance: 'Motivation for explicit multiplicity and dependence controls.' },
    ],
    limitations: [
      'The 2022+ holdout was frozen for this crossover family but its BTC prices have been inspected by prior repository work; it is historical replication evidence, not a pristine prospective test.',
      'The checked-in history is latest-revised and mixes legacy and recent CoinGecko candle construction; it is not point-in-time vintage data.',
      'Recent CoinGecko-derived opens are sampled aggregate-market observations, not guaranteed executable exchange prices.',
      'A symmetric bearish event is a statistical direction test, not a deployable short strategy; borrow, funding, liquidation, and venue constraints are not modeled.',
      'Secondary horizons and direction splits are descriptive and cannot rescue a failed Holm-corrected 30-day endpoint.',
      'Moving-block and circular-shift inference are approximate under nonstationary BTC regimes; circular wrapping does not make 2022-2026 stationary.',
      'Subperiod diagnostics require the forward target to mature inside that subperiod, so boundary-spanning events are conservatively omitted rather than forming an exhaustive partition.',
    ],
    verdict,
    implementationAuthorized: false,
    candidates: candidateResults,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `trend-reversal-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `trend-reversal-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`Trend reversal verdict: ${verdict}`);
  for (const result of candidateResults) {
    console.log(`${result.id}: n=${result.primary.events} episodes=${result.primary.distinct14DayEpisodes} effect=${formatPercent(result.primary.meanSignedExcessNetLogReturn)} CI=${formatInterval(result.primary.bootstrap95)} pHolm=${formatNumber(result.holmAdjustedPValue)} ${result.gatePassed ? 'PASS' : 'FAIL'}`);
  }
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function evaluateCandidate(candidate: Candidate): CandidateResult {
  const development = HORIZONS.map(horizon => evaluate(candidate.signal, DEVELOPMENT, horizon, horizon === PRIMARY_HORIZON, SEED ^ hash(candidate.id) ^ horizon));
  const holdout = HORIZONS.map(horizon => evaluate(candidate.signal, HOLDOUT, horizon, horizon === PRIMARY_HORIZON, SEED ^ hash(candidate.id) ^ horizon ^ 0x5555));
  const primary = holdout.find(result => result.horizonDays === PRIMARY_HORIZON)!;
  const holdoutSubperiods = {
    '2022-2024': evaluate(candidate.signal, { id: '2022-2024', start: '2022-01-01', end: '2024-12-31' }, PRIMARY_HORIZON, false, 0),
    '2025+': evaluate(candidate.signal, { id: '2025+', start: '2025-01-01', end: '9999-12-31' }, PRIMARY_HORIZON, false, 0),
  };
  return { id: candidate.id, description: candidate.description, development, holdout, primary, holdoutSubperiods, holmAdjustedPValue: null, gatePassed: false, gateReasons: [] };
}

function evaluate(
  signal: readonly CrossDirection[],
  period: { id: string; start: string; end: string },
  horizonDays: number,
  infer: boolean,
  seed: number,
): Evaluation {
  const timeline: TimelineRow[] = [];
  for (let index = 0; index + horizonDays + 1 < rows.length; index++) {
    const signalDate = rows[index].date;
    if (signalDate < period.start || signalDate > period.end) continue;
    const logReturn = nextOpenForwardLogReturn(rows, index, horizonDays, period.end);
    if (logReturn === null) continue;
    timeline.push({ index, date: signalDate, direction: signal[index], logReturn });
  }
  const mu = mean(timeline.map(row => row.logReturn));
  const events = timeline.filter(row => row.direction !== 0);
  const effects = events.map(row => row.direction * (row.logReturn - mu) - ROUND_TRIP_COST);
  const rawNet = events.map(row => row.direction * row.logReturn - ROUND_TRIP_COST);
  const up = events.filter(row => row.direction === 1).map(row => row.logReturn - mu - ROUND_TRIP_COST);
  const down = events.filter(row => row.direction === -1).map(row => -(row.logReturn - mu) - ROUND_TRIP_COST);
  const primaryEffect = nullableMean(effects);
  const bootstrap95 = infer && events.length > 0 ? blockBootstrap(timeline, horizonDays, seed) : null;
  const circularShiftPValue = infer && events.length > 0 ? circularShiftP(timeline, primaryEffect!) : null;
  const nonOverlapping = nonOverlappingReturns(events, horizonDays);
  return {
    period: period.id,
    horizonDays,
    eligibleDays: timeline.length,
    events: events.length,
    upEvents: up.length,
    downEvents: down.length,
    distinct14DayEpisodes: countEpisodes(events, 14),
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
    bootstrap95,
    circularShiftPValue,
    largestAbsoluteEventShare: contributionShare(effects),
  };
}

function finalizeGate(result: CandidateResult, adjustedPValue: number): void {
  result.holmAdjustedPValue = adjustedPValue;
  const development = result.development.find(item => item.horizonDays === PRIMARY_HORIZON)!;
  const primary = result.primary;
  const reasons: string[] = [];
  if (primary.events < 30) reasons.push(`holdout events ${primary.events} < 30`);
  if (primary.distinct14DayEpisodes < 20) reasons.push(`distinct 14-day episodes ${primary.distinct14DayEpisodes} < 20`);
  if (!((development.meanSignedExcessNetLogReturn ?? -Infinity) > 0)) reasons.push('development mean effect is not positive');
  if (!((primary.meanSignedExcessNetLogReturn ?? -Infinity) >= PRACTICAL_EFFECT)) reasons.push(`holdout mean effect is below ${(100 * PRACTICAL_EFFECT).toFixed(1)}%`);
  if (!((primary.bootstrap95?.[0] ?? -Infinity) > 0)) reasons.push('holdout bootstrap lower 95% bound is not positive');
  if (!(adjustedPValue < 0.05)) reasons.push(`Holm-adjusted p=${adjustedPValue.toFixed(5)} is not below 0.05`);
  for (const [period, evaluation] of Object.entries(result.holdoutSubperiods)) {
    if (evaluation.events >= 5 && !((evaluation.meanSignedExcessNetLogReturn ?? -Infinity) > 0)) reasons.push(`${period} effect is not positive`);
  }
  result.gateReasons = reasons;
  result.gatePassed = reasons.length === 0;
}

function blockBootstrap(timeline: readonly TimelineRow[], blockLength: number, seed: number): [number, number] {
  const rng = mulberry32(seed);
  const statistics: number[] = [];
  for (let iteration = 0; iteration < PRIMARY_BOOTSTRAP_ITERATIONS; iteration++) {
    let count = 0;
    let returnSum = 0;
    let signedReturnSum = 0;
    let directionSum = 0;
    let eventCount = 0;
    while (count < timeline.length) {
      const start = Math.floor(rng() * timeline.length);
      for (let offset = 0; offset < blockLength && count < timeline.length; offset++, count++) {
        const row = timeline[(start + offset) % timeline.length];
        returnSum += row.logReturn;
        if (row.direction !== 0) {
          signedReturnSum += row.direction * row.logReturn;
          directionSum += row.direction;
          eventCount++;
        }
      }
    }
    if (eventCount > 0) {
      const resampledMu = returnSum / timeline.length;
      statistics.push(signedReturnSum / eventCount - resampledMu * directionSum / eventCount - ROUND_TRIP_COST);
    }
  }
  statistics.sort((a, b) => a - b);
  return [quantileSorted(statistics, 0.025), quantileSorted(statistics, 0.975)];
}

function circularShiftP(timeline: readonly TimelineRow[], observed: number): number {
  const mu = mean(timeline.map(row => row.logReturn));
  let exceedances = 0;
  for (let shift = 1; shift < timeline.length; shift++) {
    let sum = 0;
    let count = 0;
    for (let index = 0; index < timeline.length; index++) {
      const direction = timeline[(index + shift) % timeline.length].direction;
      if (direction === 0) continue;
      sum += direction * (timeline[index].logReturn - mu) - ROUND_TRIP_COST;
      count++;
    }
    const statistic = count ? sum / count : -Infinity;
    if (statistic >= observed) exceedances++;
  }
  return (exceedances + 1) / timeline.length;
}

function nonOverlappingReturns(events: readonly TimelineRow[], horizonDays: number): number[] {
  const selected: number[] = [];
  let lastExitIndex = -Infinity;
  for (const event of events) {
    if (event.index + 1 <= lastExitIndex) continue;
    selected.push(event.direction * event.logReturn - ROUND_TRIP_COST);
    lastExitIndex = event.index + horizonDays + 1;
  }
  return selected;
}

function countEpisodes(events: readonly TimelineRow[], cooldownDays: number): number {
  return countCrossingEpisodes(events.map(event => event.date), cooldownDays);
}

function maximumDrawdown(returns: readonly number[]): number {
  let wealth = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of returns) {
    wealth *= Math.exp(value);
    peak = Math.max(peak, wealth);
    drawdown = Math.min(drawdown, wealth / peak - 1);
  }
  return drawdown;
}

function contributionShare(values: readonly number[]): number | null {
  if (!values.length) return null;
  const absoluteTotal = values.reduce((sum, value) => sum + Math.abs(value), 0);
  return absoluteTotal ? Math.max(...values.map(Math.abs)) / absoluteTotal : null;
}

function inspectDataQuality() {
  let gaps = 0;
  let duplicates = 0;
  let invalidOhlc = 0;
  let invalidOhlcScoredPeriod = 0;
  let zeroVolume = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.volume === 0) zeroVolume++;
    const invalid = row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close) || row.low > row.high;
    if (invalid) {
      invalidOhlc++;
      if (row.date >= DEVELOPMENT.start) invalidOhlcScoredPeriod++;
    }
    if (index > 0) {
      const difference = daysBetween(rows[index - 1].date, row.date);
      if (difference === 0) duplicates++;
      else if (difference !== 1) gaps++;
    }
  }
  return {
    frequency: 'daily UTC calendar rows',
    gaps,
    duplicates,
    zeroVolumeRows: zeroVolume,
    malformedOhlcRowsFullHistory: invalidOhlc,
    malformedOhlcRowsScoredFrom2018: invalidOhlcScoredPeriod,
    exclusion: 'Dates before 2018-01-01 are EMA/SMA warm-up only because malformed legacy OHLC rows end in 2017.',
    closeAvailability: 'Signal date close is used only after that UTC candle completes; execution begins at the next UTC open.',
  };
}

function assertDatasetOrdering(): void {
  if (rows.length < 201) throw new Error('BTC history needs at least 201 rows');
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!(row.open > 0 && row.close > 0)) throw new Error(`non-positive execution price at ${row.date}`);
    if (index > 0 && rows[index - 1].date >= row.date) throw new Error(`BTC dates are not strictly increasing at ${row.date}`);
  }
}

function renderMarkdown(report: any): string {
  const lines = [
    '# BTC Moving-Average Crossover Reversal Event Study',
    '',
    `Generated: ${report.metadata.generatedAt}`,
    '',
    `Verdict: **${report.verdict}**. Product/forecast implementation authorized: **no**.`,
    '',
    '## Claim and data',
    '',
    `The test asks whether a close-confirmed crossover predicts a direction-adjusted ${PRIMARY_HORIZON}-day return beyond the same-period unconditional BTC drift, after ${(ROUND_TRIP_COST * 10_000).toFixed(0)} bp round-trip cost. Signals execute from the next UTC open.`,
    '',
    `Data: ${report.metadata.dataset.firstDate} through ${report.metadata.dataset.lastDate} (${report.metadata.dataset.rowCount} rows), SHA-256 \`${report.metadata.datasetSha256}\`. Scoring begins 2018-01-01; 2022+ is a frozen historical holdout, not a pristine prospective sample.`,
    '',
    `Data audit: ${report.dataQuality.gaps} gaps, ${report.dataQuality.duplicates} duplicates, ${report.dataQuality.malformedOhlcRowsFullHistory} malformed legacy OHLC rows, and ${report.dataQuality.malformedOhlcRowsScoredFrom2018} malformed OHLC rows in the scored period.`,
    '',
    '## Pre-registered primary results (2022+; 30 days)',
    '',
    '| Signal | Events | 14d episodes | Up / down | Net excess | 95% block CI | Shift p | Holm p | Dev excess | Gate |',
    '|---|---:|---:|---:|---:|---|---:|---:|---:|---|',
  ];
  for (const candidate of report.candidates) {
    const dev = candidate.development.find(item => item.horizonDays === PRIMARY_HORIZON)!;
    lines.push(`| ${candidate.id} | ${candidate.primary.events} | ${candidate.primary.distinct14DayEpisodes} | ${candidate.primary.upEvents} / ${candidate.primary.downEvents} | ${formatPercent(candidate.primary.meanSignedExcessNetLogReturn)} | ${formatInterval(candidate.primary.bootstrap95)} | ${formatNumber(candidate.primary.circularShiftPValue)} | ${formatNumber(candidate.holmAdjustedPValue)} | ${formatPercent(dev.meanSignedExcessNetLogReturn)} | ${candidate.gatePassed ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('', 'A positive value means event timing beat the period-wide unconditional drift after costs. The block interval resamples contiguous daily tuples. The exact circular-shift null preserves crossover clustering while breaking signal/return alignment, but remains approximate under nonstationary market regimes.', '');
  lines.push('## Gate failures', '');
  for (const candidate of report.candidates) lines.push(`- **${candidate.id}:** ${candidate.gateReasons.length ? candidate.gateReasons.join('; ') : 'none'}.`);
  lines.push('', '## Horizon and direction diagnostics', '');
  lines.push('| Signal | Period | h | Events | Episodes | Excess | Win rate | Up excess | Down excess | Non-overlap max DD |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const candidate of report.candidates) {
    for (const evaluation of [...candidate.development, ...candidate.holdout]) {
      lines.push(`| ${candidate.id} | ${evaluation.period} | ${evaluation.horizonDays} | ${evaluation.events} | ${evaluation.distinct14DayEpisodes} | ${formatPercent(evaluation.meanSignedExcessNetLogReturn)} | ${formatPercent(evaluation.winRate)} | ${formatPercent(evaluation.upMeanExcessNetLogReturn)} | ${formatPercent(evaluation.downMeanExcessNetLogReturn)} | ${formatPercent(evaluation.nonOverlappingMaxDrawdown)} |`);
    }
  }
  lines.push('', '## Math and leakage proof', '', `- Feature values at date \`t\` use closes no later than \`t\`. SMA is trailing-only; EMA recursion has no future term.`, `- A cross is confirmed only after close \`t\`. Return measurement starts at \`open[t+1]\` and ends at \`open[t+h+1]\`; therefore the feature cannot see its evaluated return.`, `- Primary effect: \`${report.formulas.primaryEffect}\`. Subtracting \`s_i * mu_h\` prevents BTC's positive drift from automatically making every bullish rule look predictive.`, `- Inference uses ${PRIMARY_BOOTSTRAP_ITERATIONS.toLocaleString()} horizon-length circular moving-block samples and every nonzero circular shift available in the evaluation period. Holm adjustment covers all seven frozen 30-day rules. Both dependence procedures are approximate under BTC regime nonstationarity.`, '');
  lines.push('## Research context', '', '- [Brock, Lakonishok & LeBaron (1992)](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1992.tb04681.x) motivates the canonical price/SMA200 rule and fixed 1% band.', '- [Detzel et al. (2021)](https://onlinelibrary.wiley.com/doi/10.1111/fima.12310) reports BTC return predictability from shorter price/MA ratios.', '- [Hudson & Urquhart (2021)](https://link.springer.com/article/10.1007/s10479-019-03357-1) finds technical-rule profitability does not survive their pure out-of-sample BTC test.', '- [White (2000)](https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152) explains why searched technical rules require data-snooping controls.', '');
  lines.push('## Reproduction and decision', '', `- Command: \`${report.metadata.command}\``, `- Git commit: \`${report.metadata.gitCommit}\``, `- Seed: \`${report.metadata.seed}\``, '- No UI, product, regime, or forecast-model behavior changed. A historical positive would still require independent exchange candles and a genuinely prospective frozen sample before integration.', '');
  return `${lines.join('\n')}\n`;
}

function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN; }
function nullableMean(values: readonly number[]): number | null { return values.length ? mean(values) : null; }
function median(values: readonly number[]): number | null { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function quantileSorted(values: readonly number[], q: number): number { if (!values.length) return NaN; const index = (values.length - 1) * q; const lower = Math.floor(index); const upper = Math.ceil(index); return values[lower] + (values[upper] - values[lower]) * (index - lower); }
function daysBetween(a: string, b: string): number { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000); }
function gitCommit(): string { try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } }
function fileSha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function hash(value: string): number { let result = 2166136261; for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); } return result >>> 0; }
function mulberry32(seed: number): () => number { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) >>> 0; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296; }; }
function formatNumber(value: number | null): string { return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(5); }
function formatPercent(value: number | null): string { return value === null || !Number.isFinite(value) ? 'n/a' : `${(100 * value).toFixed(2)}%`; }
function formatInterval(value: [number, number] | null): string { return value ? `[${formatPercent(value[0])}, ${formatPercent(value[1])}]` : 'n/a'; }

main();
