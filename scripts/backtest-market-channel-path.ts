import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import vooHistory from '../src/data/voo-history.json';
import gldHistory from '../src/data/gld-history.json';
import type { OHLCVData } from '../src/lib/api';
import {
  computeGoldChannelBounds, computeGoldModelInputs, computeSP500ChannelBounds, computeSP500ModelInputs,
} from '../src/lib/marketForecast';
import {
  buildFrozenResidualChannel, buildMarketForecastChannel, MARKET_CHANNEL_CANDIDATE_CONFIG,
} from '../src/lib/marketForecastChannel';

const LEADS = [5, 10, 20, 30, 60, 90, 120, 180] as const;
const GATED_LEADS = [30, 90, 180] as const;
const MIN_TRAINING_ROWS = 1000;
const OUTER_STEP = 30;
const DATE = '2026-07-10';
const BOOTSTRAP_ITERATIONS = 2000;

interface ScoreRow {
  asset: string; originDate: string; targetDate: string; lead: number; seed: number; sourceDataHash: string;
  baselineLower: number; baselineUpper: number; candidateLower: number; candidateUpper: number; actual: number;
  baselineLowerPinball: number; baselineUpperPinball: number; candidateLowerPinball: number; candidateUpperPinball: number;
  baselineIntervalScore: number; candidateIntervalScore: number; baselineLogWidth: number; candidateLogWidth: number;
  baselineCovered: boolean; candidateCovered: boolean; baselineCurvature: number; candidateCurvature: number;
  baselineDirectionChanges: number; candidateDirectionChanges: number;
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const pinball = (actual: number, forecast: number, q: number) => (actual >= forecast ? q : q - 1) * (actual - forecast);
const intervalScore = (actual: number, lower: number, upper: number) => (upper - lower) + 20 * Math.max(0, lower - actual) + 20 * Math.max(0, actual - upper);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function rngFromSeed(initial: number): () => number {
  let seed = initial >>> 0;
  return () => { let x = seed += 0x6d2b79f5; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}

function correctedBootstrap(differences: number[], seed: number, comparisons: number) {
  if (!differences.length) return { lower95: null, upper95: null, pValue: null, correctedPValue: null };
  const rng = rngFromSeed(seed); const estimates: number[] = [];
  const block = Math.max(1, Math.ceil(differences.length / 10));
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration++) {
    const sample: number[] = [];
    while (sample.length < differences.length) {
      const start = Math.floor(rng() * differences.length);
      for (let offset = 0; offset < block && sample.length < differences.length; offset++) sample.push(differences[(start + offset) % differences.length]);
    }
    estimates.push(mean(sample));
  }
  estimates.sort((a, b) => a - b);
  const p = estimates.filter((value) => value <= 0).length / estimates.length;
  return { lower95: estimates[Math.floor(estimates.length * 0.025)], upper95: estimates[Math.floor(estimates.length * 0.975)], pValue: p, correctedPValue: Math.min(1, p * comparisons) };
}

function curvature(points: { lower: number; upper: number }[], key: 'lower' | 'upper'): number {
  const logs = points.map((point) => Math.log(point[key]));
  return mean(logs.slice(2).map((value, index) => Math.abs(value - 2 * logs[index + 1] + logs[index])));
}

function directionChanges(points: { lower: number; upper: number }[], key: 'lower' | 'upper'): number {
  const differences = points.slice(1).map((point, index) => Math.sign(Math.log(point[key] / points[index][key])));
  return differences.slice(1).filter((sign, index) => sign !== 0 && differences[index] !== 0 && sign !== differences[index]).length;
}

function evaluateAsset(asset: string, rows: OHLCVData[], baselineOnly: boolean) {
  const sourceDataHash = hash(rows);
  const bounds = asset === 'sp500' ? computeSP500ChannelBounds(rows) : computeGoldChannelBounds(rows);
  const computeInputs = asset === 'sp500' ? computeSP500ModelInputs : computeGoldModelInputs;
  const outerStart = Math.max(MIN_TRAINING_ROWS, Math.floor(rows.length * 0.6));
  const scored: ScoreRow[] = [];
  let invalidPaths = 0; let continuityFailures = 0;
  for (let originIndex = outerStart; originIndex + 180 < rows.length; originIndex += OUTER_STEP) {
    const training = rows.slice(0, originIndex + 1);
    const model = computeInputs(training);
    const channel = bounds[originIndex];
    const baseOptions = {
      assetId: asset as 'sp500' | 'gold', rows: training, horizon: 180, drift: model.drift, dailyVol: model.dailyVol,
      seed: Number.parseInt(hash(`${asset}:${rows[originIndex].date}:180:moving-block-price-quantiles-v1:market-channel-path-v1`).slice(0, 8), 16),
      baselineTrend: channel.trend, baselineLowerResidual: channel.lowerResidual, baselineUpperResidual: channel.upperResidual,
    };
    const baseline = buildFrozenResidualChannel(baseOptions);
    const candidate = baselineOnly ? baseline : buildMarketForecastChannel({ ...baseOptions, config: { ...MARKET_CHANNEL_CANDIDATE_CONFIG, simulations: 1000 } });
    if (baseline.points.length !== 180 || candidate.points.length !== 180) { invalidPaths++; continue; }
    if (baseline.points.some((point) => !Number.isFinite(point.lower + point.upper) || point.lower <= 0 || point.lower > point.upper)
      || candidate.points.some((point) => !Number.isFinite(point.lower + point.upper) || point.lower <= 0 || point.lower > point.upper)) { invalidPaths++; continue; }
    const baselineCurve = curvature(baseline.points, 'lower') + curvature(baseline.points, 'upper');
    const candidateCurve = curvature(candidate.points, 'lower') + curvature(candidate.points, 'upper');
    const baselineTurns = directionChanges(baseline.points, 'lower') + directionChanges(baseline.points, 'upper');
    const candidateTurns = directionChanges(candidate.points, 'lower') + directionChanges(candidate.points, 'upper');
    for (const lead of LEADS) {
      const actualRow = rows[originIndex + lead]; const base = baseline.points[lead - 1]; const cand = candidate.points[lead - 1];
      if (!actualRow || base.date !== actualRow.date || cand.date !== actualRow.date || actualRow.date <= rows[originIndex].date) { continuityFailures++; continue; }
      scored.push({ asset, originDate: rows[originIndex].date, targetDate: actualRow.date, lead, seed: baseOptions.seed, sourceDataHash,
        baselineLower: base.lower, baselineUpper: base.upper, candidateLower: cand.lower, candidateUpper: cand.upper, actual: actualRow.close,
        baselineLowerPinball: pinball(actualRow.close, base.lower, 0.05), baselineUpperPinball: pinball(actualRow.close, base.upper, 0.95),
        candidateLowerPinball: pinball(actualRow.close, cand.lower, 0.05), candidateUpperPinball: pinball(actualRow.close, cand.upper, 0.95),
        baselineIntervalScore: intervalScore(actualRow.close, base.lower, base.upper), candidateIntervalScore: intervalScore(actualRow.close, cand.lower, cand.upper),
        baselineLogWidth: Math.log(base.upper / base.lower), candidateLogWidth: Math.log(cand.upper / cand.lower),
        baselineCovered: actualRow.close >= base.lower && actualRow.close <= base.upper,
        candidateCovered: actualRow.close >= cand.lower && actualRow.close <= cand.upper,
        baselineCurvature: baselineCurve, candidateCurvature: candidateCurve,
        baselineDirectionChanges: baselineTurns, candidateDirectionChanges: candidateTurns,
      });
    }
  }
  const comparisons = 2 * GATED_LEADS.length;
  const summaries = LEADS.map((lead) => {
    const subset = scored.filter((row) => row.lead === lead);
    const improvement = subset.map((row) => row.baselineIntervalScore - row.candidateIntervalScore);
    const baselineScore = mean(subset.map((row) => row.baselineIntervalScore));
    const candidateScore = mean(subset.map((row) => row.candidateIntervalScore));
    const inference = correctedBootstrap(improvement, 0x7000 + lead + (asset === 'gold' ? 1000 : 0), comparisons);
    return { lead, samples: subset.length, nominalNonOverlappingEquivalent: subset.length * OUTER_STEP / lead,
      baselineIntervalScore: baselineScore, candidateIntervalScore: candidateScore,
      intervalScoreImprovementPct: baselineScore ? (baselineScore - candidateScore) / baselineScore * 100 : 0,
      baselineCoverage: mean(subset.map((row) => Number(row.baselineCovered))), candidateCoverage: mean(subset.map((row) => Number(row.candidateCovered))),
      baselineLowerPinball: mean(subset.map((row) => row.baselineLowerPinball)), candidateLowerPinball: mean(subset.map((row) => row.candidateLowerPinball)),
      baselineUpperPinball: mean(subset.map((row) => row.baselineUpperPinball)), candidateUpperPinball: mean(subset.map((row) => row.candidateUpperPinball)),
      baselineMeanLogWidth: mean(subset.map((row) => row.baselineLogWidth)), candidateMeanLogWidth: mean(subset.map((row) => row.candidateLogWidth)),
      baselineCurvature: mean(subset.map((row) => row.baselineCurvature)), candidateCurvature: mean(subset.map((row) => row.candidateCurvature)),
      baselineDirectionChanges: mean(subset.map((row) => row.baselineDirectionChanges)), candidateDirectionChanges: mean(subset.map((row) => row.candidateDirectionChanges)), ...inference };
  });
  const gated = summaries.filter((row) => GATED_LEADS.includes(row.lead as 30 | 90 | 180));
  const enoughData = gated.every((row) => row.nominalNonOverlappingEquivalent >= 30);
  const passes = !baselineOnly && enoughData && invalidPaths === 0 && continuityFailures === 0 && gated.every((row) =>
    row.intervalScoreImprovementPct >= 2 && (row.lower95 ?? -Infinity) > 0 && (row.correctedPValue ?? 1) < 0.05
    && row.candidateCoverage >= 0.85 && row.candidateCoverage <= 0.95 && row.candidateCoverage >= row.baselineCoverage - 0.02
    && row.candidateLowerPinball <= row.baselineLowerPinball * 1.01 && row.candidateUpperPinball <= row.baselineUpperPinball * 1.01
    && row.candidateMeanLogWidth <= row.baselineMeanLogWidth * 1.10);
  return { asset, sourceDataHash, outerStartDate: rows[outerStart].date, outerEndDate: rows.at(-181)?.date, invalidPaths, continuityFailures,
    verdict: baselineOnly ? 'baseline-only' : !enoughData ? 'needs-more-data' : passes ? 'promote' : 'reject', summaries, rows: scored };
}

export function runMarketChannelPathBacktest(mode: 'baseline' | 'candidates') {
  const baselineOnly = mode === 'baseline';
  const assets = [evaluateAsset('sp500', vooHistory as OHLCVData[], baselineOnly), evaluateAsset('gold', gldHistory as OHLCVData[], baselineOnly)];
  const gitCommit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
  const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(), mode, gitCommit,
    configuration: { minimumTrainingRows: MIN_TRAINING_ROWS, leads: LEADS, gatedLeads: GATED_LEADS, outerOriginStep: OUTER_STEP,
      outerSplit: 'final 40% of rows', innerSelection: 'pre-registered primary config frozen; neighboring configurations are deferred because the minimum sample gate is impossible',
      candidate: MARKET_CHANNEL_CANDIDATE_CONFIG, bootstrap: { type: 'paired-moving-block', iterations: BOOTSTRAP_ITERATIONS, multiplicity: 'Bonferroni across 2 assets x 3 horizons' },
      seedPolicy: 'sha256(asset, origin, horizon, candidate id, configuration version) first uint32' }, assets };
  mkdirSync('docs/reports/results', { recursive: true });
  const stem = `docs/reports/results/market-channel-path-${baselineOnly ? 'baseline' : 'candidates'}-${DATE}`;
  writeFileSync(`${stem}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  const lines = [`# Market channel path ${baselineOnly ? 'baseline' : 'candidate'} report — ${DATE}`, '',
    baselineOnly ? 'The frozen-residual baseline has affine log bounds, so its second differences are numerically zero. Curvature is diagnostic only.' : 'This report applies the pre-registered statistical gate. Visual curvature is not a promotion condition.', '',
    `Git commit: \`${gitCommit}\``, `Configuration version: \`${MARKET_CHANNEL_CANDIDATE_CONFIG.configurationVersion}\``, ''];
  for (const asset of assets) {
    lines.push(`## ${asset.asset}`, '', `Verdict: **${asset.verdict}**`, '', '| Lead | N | Non-overlap eq. | Baseline score | Candidate score | Improvement | Baseline cov. | Candidate cov. | Corrected p |', '|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const row of asset.summaries) lines.push(`| ${row.lead} | ${row.samples} | ${row.nominalNonOverlappingEquivalent.toFixed(1)} | ${row.baselineIntervalScore.toFixed(4)} | ${row.candidateIntervalScore.toFixed(4)} | ${row.intervalScoreImprovementPct.toFixed(2)}% | ${(row.baselineCoverage * 100).toFixed(1)}% | ${(row.candidateCoverage * 100).toFixed(1)}% | ${row.correctedPValue?.toFixed(4) ?? 'n/a'} |`);
    lines.push('', `Invalid paths: ${asset.invalidPaths}; target-date/session mismatches: ${asset.continuityFailures}.`, '');
  }
  lines.push('## Verdict', '', baselineOnly ? 'Baseline quantified; no runtime change is authorized.' : assets.every((asset) => asset.verdict === 'promote') ? 'All asset-specific gates pass.' : 'At least one required gate fails or lacks sufficient independent outcomes. Retain current runtime channels; Phase 3 is not authorized.', '');
  writeFileSync(`${stem}.md`, `${lines.join('\n')}\n`);
  console.log(`[market channel path] wrote ${stem}.md and ${stem}.json`);
  for (const asset of assets) console.log(`[market channel path] ${asset.asset}: ${asset.verdict}`);
}
