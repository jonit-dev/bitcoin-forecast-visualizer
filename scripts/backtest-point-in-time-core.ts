import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { PIT_HORIZONS, PIT_SEED, runPointInTimeBenchmark, type PitCandidateId } from '../src/lib/pointInTimeForecast';
import { seededRandom } from '../src/lib/random';
const PATH_TOLERANCES = Object.freeze({ variance:.35, lag1Autocorrelation:.25, absoluteLag1Autocorrelation:.25, tails:.35, maximumDrawdown:.35, maximumDrawdownDuration:.35, signChangeRate:.20, realizedVolatility:.25 });

const args = process.argv.slice(2);
const originStart = valueAfter('--origin-start') ?? '2017-01-01';
const spacingDays = Number(valueAfter('--spacing-days') ?? 30);
const candidate = valueAfter('--candidate') as PitCandidateId | undefined;
const candidates: PitCandidateId[] = ['structural-shrinkage','state-space-residual','calibrated-jagged-path'];
if (candidate && !candidates.includes(candidate)) throw new Error(`--candidate must be one of ${candidates.join(', ')}`);
if (!Number.isInteger(spacingDays) || spacingDays < 1) throw new Error('--spacing-days must be a positive integer');
const dataset = btcHistory as OHLCVData[];
const result = runPointInTimeBenchmark({ ohlcv: dataset, originStart, spacingDays, seed: PIT_SEED, candidate });
const candidateEvaluation = candidate ? evaluateCandidate(result.origins, candidate) : undefined;
const deterministicContentSha256 = createHash('sha256').update(JSON.stringify({ candidate, originStart, spacingDays, seed:PIT_SEED, candidateEvaluation, origins:result.origins, skips:result.skips })).digest('hex');
const generatedAt = new Date().toISOString();
const currentGitCommit = gitCommit();
const originsWithProvenance = result.origins.map(origin => ({ ...origin, gitCommit: currentGitCommit }));
const report = {
  metadata: { generatedAt, command: `npm run backtest:pit-core -- ${args.join(' ')}`.trim(), gitCommit: currentGitCommit, seed: PIT_SEED,
    closeAvailabilityConvention: 'UTC daily close is available after that date closes; structural fit includes the origin close; calibration targets must be strictly earlier than origin.',
    dataset: { firstDate: dataset[0].date, lastDate: dataset.at(-1)!.date, rowCount: dataset.length, sha256: createHash('sha256').update(JSON.stringify(dataset)).digest('hex') },
    originStart, spacingDays, horizons: PIT_HORIZONS, candidate: candidate ?? null, deterministicContentSha256, deterministicRerunContract:'same data/config/seed produces the same content hash; generatedAt and artifact filename excluded' },
  methodology: { status: 'report-only', structuralFit: 'expanding point-in-time power-law fit through origin close', intervalCalibration: 'prior reconstructed-policy errors with targetDate < originDate', benchmarkSchedule: 'identical origin/horizon rows for all available models', nestedSelection: 'six inner walk-forward folds wholly before each outer origin; candidates selected on inner target MALE only' },
  frozenSpecification: { innerFolds:6, minimumTrainingRows:1460, fitWindows:'expanding through inner origin; YL-1 anchor ends at least one horizon earlier', initialization:'YL-1 default weight 0.5 and YL-2 grid index 1 only when no valid inner folds', missingData:'state-space prediction-only update; invalid structural fits score Infinity', failureBehavior:'report skip/reject; never silently enable candidate', structuralShrinkageWeights:[0.25,0.5,0.75], stateSpaceGridSize:3, bootstrapIterations:1000, bootstrapBlockDays:'max(horizon, observed origin spacing)', holmFamily:'four horizons', pathMethods:['current-recent-window','moving-block','volatility-regime','state-space'], seed:PIT_SEED },
  benchmarkMetrics: summarizeBenchmarks(result.origins), candidateEvaluation, origins: originsWithProvenance, skips: result.skips,
};
const stamp = generatedAt.replace(/[.:]/g, '-');
const base = `docs/reports/results/point-in-time-${candidate ?? 'core'}-${stamp}`;
mkdirSync('docs/reports/results', { recursive: true });
writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(`${base}.md`, render(report));
console.log(`PIT core: ${result.origins.length} origin/horizon rows; ${result.skips.length} skips`);
console.log(`JSON: ${base}.json`); console.log(`Markdown: ${base}.md`);

function valueAfter(flag: string): string | undefined { const i=args.indexOf(flag); return i<0?undefined:args[i+1]; }
function gitCommit(): string { try { return execSync('git rev-parse HEAD',{encoding:'utf8'}).trim(); } catch { return 'unknown'; } }
function summarizeBenchmarks(origins: typeof result.origins) { const groups=new Map<string,number[]>(); for(const o of origins)for(const b of o.benchmarks){const key=`${o.horizonDays}:${b.modelId}`; (groups.get(key)??groups.set(key,[]).get(key)!).push(b.absLogError);} return [...groups].map(([key,errors])=>{const [horizonDays,modelId]=key.split(':'); return {horizonDays:Number(horizonDays),modelId,samples:errors.length,meanAbsoluteLogError:errors.reduce((a,b)=>a+b,0)/errors.length};}); }
function evaluateCandidate(origins: typeof result.origins, id: PitCandidateId) {
  const checks=PIT_HORIZONS.map(h=>{const rows=origins.filter(o=>o.horizonDays===h&&o.candidate); const paired=rows.map(o=>{const base=o.benchmarks.find(b=>b.modelId==='reconstructed-current-policy')!; const c=o.candidate!; return {date:o.originDate,difference:base.absLogError-c.absLogError,base,candidate:c,actual:base.actual,originClose:o.benchmarks.find(b=>b.modelId==='naive-current-price')!.median};}); const diffs=paired.map(x=>x.difference); const ci=blockBootstrap(diffs,Math.max(1,Math.ceil(h/Math.max(1,spacingDays))),PIT_SEED+h); const baseMale=mean(paired.map(x=>x.base.absLogError)); const candidateMale=mean(paired.map(x=>x.candidate.absLogError)); const naive=rows.flatMap(o=>o.benchmarks.filter(b=>b.modelId!=='reconstructed-current-policy').map(b=>({id:b.modelId,error:b.absLogError})));const naiveBy=new Map<string,number[]>();for(const n of naive)(naiveBy.get(n.id)??naiveBy.set(n.id,[]).get(n.id)!).push(n.error);const bestNaive=[...naiveBy].map(([id,xs])=>({id,male:mean(xs)})).sort((a,b)=>a.male-b.male)[0]; const pValue=ci.samples?ci.nonPositive/ci.samples:1; const sorted=[...paired].sort((a,b)=>a.candidate.absLogError-b.candidate.absLogError); const bias=mean(paired.map(x=>Math.log(x.candidate.median/x.actual))); const direction=mean(paired.map(x=>Math.sign(x.candidate.median-x.originClose)===Math.sign(x.actual-x.originClose)?1:0)); const regimes=regimeMetrics(paired); const sensitivity=parameterSensitivity(rows); const calibration=distributionMetrics(rows); return {horizonDays:h,samples:paired.length,baselineMale:baseMale,candidateMale,bestNaive,relativeMaleImprovement:baseMale?(baseMale-candidateMale)/baseMale:0,medianAbsoluteLogError:sorted.length?sorted[Math.floor(sorted.length/2)].candidate.absLogError:null,biasLogError:bias,directionHitRate:direction,bootstrap95:[ci.low,ci.high],rawPValue:pValue,holmAdjustedPValue:null as number|null,regimeRobustness:regimes,parameterSensitivity:sensitivity,distributionCalibration:calibration};});
  const ranked=[...checks].sort((a,b)=>a.rawPValue-b.rawPValue); let priorAdjusted=0; ranked.forEach((row,i)=>{priorAdjusted=Math.max(priorAdjusted,Math.min(1,row.rawPValue*(ranked.length-i)));row.holmAdjustedPValue=priorAdjusted;}); const pathDiagnostics=id==='calibrated-jagged-path'?aggregatePath(origins):null; const gateChecks=checks.map(c=>({horizonDays:c.horizonDays,maxRegressionPass:c.relativeMaleImprovement>=-.005,signPass:Math.abs(c.biasLogError)<.25,regimePass:Object.values(c.regimeRobustness).filter((r:any)=>r.samples>=5).every((r:any)=>r.meanPairedImprovement>=0),sensitivityPass:c.parameterSensitivity.length===0||Math.max(...c.parameterSensitivity.map(x=>x.male))/Math.max(1e-12,Math.min(...c.parameterSensitivity.map(x=>x.male)))<1.25,calibrationPass:c.distributionCalibration.coverage.every(x=>x.delta>=-.02)&&c.distributionCalibration.meanPinballDelta<=0&&c.distributionCalibration.candidateNll<=c.distributionCalibration.baselineNll,fitPass:c.samples>0&&c.distributionCalibration.samples>0})); const passes=checks.some(c=>c.relativeMaleImprovement>=.02&&c.bootstrap95[0]>0&&c.holmAdjustedPValue!<.05)&&gateChecks.every(g=>Object.values(g).slice(1).every(Boolean)); const verdict=id==='calibrated-jagged-path'?(pathDiagnostics?.pathValidityPass?'path-validity-development-signal-only; q50 unchanged':'rejected-path-validity-gate'):passes?'development-signal-only; prospective confirmation required':'rejected-development-gate'; return {candidate:id,status:'research-only',verdict,checks,gateChecks,pathDiagnostics,previouslyInspectedPeriods:'2017-2021, 2022-2024, and 2025+ are robustness diagnostics, not clean confirmation'};
}
function mean(xs:number[]):number{return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function blockBootstrap(xs:number[],block:number,seed:number){if(!xs.length)return{low:0,high:0,nonPositive:1,samples:0};const rng=seededRandom(seed);const means:number[]=[];for(let n=0;n<1000;n++){const sample:number[]=[];while(sample.length<xs.length){const start=Math.floor(rng()*Math.max(1,xs.length-block+1));sample.push(...xs.slice(start,start+block));}means.push(mean(sample.slice(0,xs.length)));}means.sort((a,b)=>a-b);return{low:means[25],high:means[974],nonPositive:means.filter(x=>x<=0).length,samples:means.length};}
function regimeMetrics(rows:any[]){const buckets={"2017-2021":rows.filter(r=>r.date<'2022-01-01'),"2022-2024":rows.filter(r=>r.date>='2022-01-01'&&r.date<'2025-01-01'),"2025+":rows.filter(r=>r.date>='2025-01-01')};return Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,{samples:v.length,meanPairedImprovement:mean(v.map((x:any)=>x.difference))}]));}
function parameterSensitivity(rows:typeof result.origins){const groups=new Map<string,number[]>();for(const o of rows)for(const s of o.candidate?.sensitivity??[])(groups.get(s.parameter)??groups.set(s.parameter,[]).get(s.parameter)!).push(s.absLogError);return [...groups].map(([parameter,xs])=>({parameter,male:mean(xs)}));}
function distributionMetrics(rows: typeof result.origins) {
  const eligible = rows.filter(row => row.interval.q80AbsLogError !== null && row.interval.q95AbsLogError !== null);
  const loss = (actual: number, predicted: number, q: number) => {
    const error = actual - predicted;
    return Math.max(q * error, (q - 1) * error);
  };
  const distributions = eligible.map(row => {
    const actual = Math.log(row.benchmarks[0].actual);
    const baselineCenter = Math.log(row.benchmarks[0].median);
    const candidateCenter = Math.log(row.candidate!.median);
    const q80 = row.interval.q80AbsLogError!;
    const sigma = Math.max(1e-9, row.interval.q95AbsLogError! / 1.959964);
    const terminal = row.candidate!.pathDiagnostics?.terminalQuantiles;
    const candidateQuantiles = terminal
      ? { q10: candidateCenter + terminal.q10, q50: candidateCenter + terminal.q50, q90: candidateCenter + terminal.q90 }
      : { q10: candidateCenter - q80, q50: candidateCenter, q90: candidateCenter + q80 };
    return {
      actual,
      sigma,
      baseline: { q10: baselineCenter - q80, q50: baselineCenter, q90: baselineCenter + q80 },
      candidate: candidateQuantiles,
    };
  });
  const pinball = (side: 'baseline' | 'candidate', key: 'q10' | 'q50' | 'q90', q: number) =>
    mean(distributions.map(row => loss(row.actual, row[side][key], q)));
  const nll = (side: 'baseline' | 'candidate') => mean(distributions.map(row => {
    const error = row.actual - row[side].q50;
    return .5 * Math.log(2 * Math.PI * row.sigma ** 2) + error ** 2 / (2 * row.sigma ** 2);
  }));
  const coverage = [.8, .9, .95].map(level => {
    const z = level === .8 ? 1.281552 : level === .9 ? 1.644854 : 1.959964;
    const rates = (side: 'baseline' | 'candidate') => distributions.filter(row =>
      Math.abs(row.actual - row[side].q50) <= z * row.sigma).length / Math.max(1, distributions.length);
    const baseline = rates('baseline');
    const candidate = rates('candidate');
    return { level, samples: distributions.length, baseline, candidate, delta: candidate - baseline,
      meanLogWidth: mean(distributions.map(row => 2 * z * row.sigma)) };
  });
  const baselinePinball = { q10: pinball('baseline', 'q10', .1), q50: pinball('baseline', 'q50', .5), q90: pinball('baseline', 'q90', .9) };
  const candidatePinball = { q10: pinball('candidate', 'q10', .1), q50: pinball('candidate', 'q50', .5), q90: pinball('candidate', 'q90', .9) };
  return { samples: distributions.length, baselinePinball, candidatePinball,
    meanPinballDelta: mean((['q10', 'q50', 'q90'] as const).map(key => candidatePinball[key] - baselinePinball[key])),
    baselineNll: nll('baseline'), candidateNll: nll('candidate'), coverage };
}
function aggregatePath(origins:typeof result.origins){const rows=origins.map(o=>o.candidate?.pathDiagnostics).filter(Boolean) as NonNullable<NonNullable<(typeof origins)[number]['candidate']>['pathDiagnostics']>[];const keys=['variance','lag1Autocorrelation','absoluteLag1Autocorrelation','signChangeRate','q05','q95','maximumDrawdown','maximumDrawdownDuration'] as const;const methods=['current-recent-window','moving-block','volatility-regime','state-space'];return{samples:rows.length,selectedMethod:'volatility-regime contiguous blocks',realizedVolatilityDistribution:{source:quantiles(rows.map(r=>Math.sqrt(r.source.variance))),generated:quantiles(rows.map(r=>Math.sqrt(r.generated.variance)))},diagnostics:Object.fromEntries(keys.map(k=>[k,{source:mean(rows.map(r=>r.source[k])),generated:mean(rows.map(r=>r.generated[k])),relativeDifference:mean(rows.map(r=>(r.generated[k]-r.source[k])/(Math.abs(r.source[k])||1))),bootstrapTolerance95:blockBootstrap(rows.map(r=>Math.abs(r.generated[k]-r.source[k])),1,PIT_SEED)}])),methodComparison:methods.map(method=>({method,diagnostics:Object.fromEntries(keys.map(k=>[k,mean(rows.map(r=>r.comparisons.find(c=>c.method===method)!.diagnostics[k]))]))})),twoSampleTolerance:'per-origin absolute diagnostic deltas with moving bootstrap; tails, drawdown, dependence and realized volatility included',terminalCalibration:'horizon-scaled simulated q10/q50/q90 with pinball/NLL/coverage/width in horizon checks'};}
function quantiles(xs:number[]){const s=[...xs].sort((a,b)=>a-b);return{q05:s[Math.floor((s.length-1)*.05)]??null,q50:s[Math.floor((s.length-1)*.5)]??null,q95:s[Math.floor((s.length-1)*.95)]??null};}
function render(r: typeof report): string { const sample=r.origins.slice(0,12); const candidateSection=r.candidateEvaluation?`\n## Candidate evaluation\n\n- Candidate: ${r.candidateEvaluation.candidate}\n- Verdict: **${r.candidateEvaluation.verdict}** (${r.candidateEvaluation.status})\n- Previously inspected periods are robustness-only.\n\n| h | n | Baseline MALE | Candidate MALE | Relative improvement | Bootstrap 95% | Holm p | Direction |\n|---:|---:|---:|---:|---:|---|---:|---:|\n${r.candidateEvaluation.checks.map(c=>`| ${c.horizonDays} | ${c.samples} | ${c.baselineMale.toFixed(6)} | ${c.candidateMale.toFixed(6)} | ${(100*c.relativeMaleImprovement).toFixed(2)}% | [${c.bootstrap95.map(x=>x.toFixed(6)).join(', ')}] | ${c.holmAdjustedPValue?.toFixed(4)} | ${(100*c.directionHitRate).toFixed(1)}% |`).join('\n')}\n`:''; return `# Point-In-Time ${r.metadata.candidate??'Core'} Benchmark\n\nStatus: report-only; no runtime forecast changes.\n\n## Provenance\n\n- Generated: ${r.metadata.generatedAt}\n- Git commit: \`${r.metadata.gitCommit}\`\n- Seed: ${r.metadata.seed}\n- Data SHA-256: \`${r.metadata.dataset.sha256}\`\n- Data: ${r.metadata.dataset.firstDate} through ${r.metadata.dataset.lastDate} (${r.metadata.dataset.rowCount} rows)\n- Close availability: ${r.metadata.closeAvailabilityConvention}\n- Origin rows: ${r.origins.length}; skips: ${r.skips.length}\n${candidateSection}\n## Benchmark comparison\n\n| Horizon | Model | Samples | MALE |\n|---:|---|---:|---:|\n${r.benchmarkMetrics.map(m=>`| ${m.horizonDays} | ${m.modelId} | ${m.samples} | ${m.meanAbsoluteLogError.toFixed(6)} |`).join('\n')}\n\n## Per-origin provenance sample\n\n| Origin | Target | h | Train start | Train end | Last known target | Coefficients | Interval snapshot | Data hash | Seed | Benchmarks |\n|---|---|---:|---|---|---|---|---|---|---:|---|\n${sample.map(o=>`| ${o.originDate} | ${o.targetDate} | ${o.horizonDays} | ${o.trainingStart} | ${o.trainingEnd} | ${o.lastKnownTargetDate??'none'} | c=${o.coefficients.coefficient.toPrecision(5)}, e=${o.coefficients.exponent.toFixed(5)} | n=${o.interval.maturedErrors}, q90=${o.interval.q90AbsLogError?.toFixed(5)??'n/a'} | \`${o.dataHash.slice(0,12)}\` | ${o.seed} | ${o.benchmarks.map(b=>b.modelId).join(', ')} |`).join('\n')}\n\nThe JSON artifact contains nested-selection metadata, robustness, sensitivity, provenance, skip reasons, and all rows. Differences from legacy backtests are methodology findings.\n`; }
