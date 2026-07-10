import { createHash } from 'node:crypto';
import type { OHLCVData } from './api';
import { fitPowerLawCoefficients, forecastWithPowerLawCoefficients, type PowerLawFitCoefficients } from './powerLawFit';
import { daysSinceGenesis } from './powerLaw';
import { fittedBasePowerLawPrice } from './powerLawFit';
import { STATE_SPACE_PARAMETER_GRID, computePathDiagnostics, fitLocalLevelResidualModel, forecastStateSpaceResidual, generateOriginSafeInnovations, type PathDiagnostics } from './stateSpaceResidual';

export const PIT_HORIZONS = [14, 30, 60, 90] as const;
export const PIT_SEED = 0x594c0000;
export const STRUCTURAL_SHRINKAGE_GRID = Object.freeze([0.25, 0.5, 0.75] as const);
export const INNER_WALK_FORWARD_FOLDS = 6;
export const INNER_MIN_TRAINING_ROWS = 1460;
export type PitCandidateId = 'structural-shrinkage' | 'state-space-residual' | 'calibrated-jagged-path';

export type PitBenchmarkId = 'reconstructed-current-policy' | 'naive-current-price' | 'gbm-driftless' | 'gbm-recent-drift' | 'ma-trend-20-50-200';

export interface PitIntervalSnapshot {
  maturedErrors: number;
  lastKnownTargetDate: string | null;
  q80AbsLogError: number | null;
  q90AbsLogError: number | null;
  q95AbsLogError: number | null;
}

export interface PitBenchmarkRow {
  modelId: PitBenchmarkId;
  median: number;
  actual: number;
  absLogError: number;
}

export interface PitOriginRecord {
  originDate: string;
  targetDate: string;
  horizonDays: number;
  trainingStart: string;
  trainingEnd: string;
  trainingRows: number;
  lastKnownTargetDate: string | null;
  coefficients: PowerLawFitCoefficients;
  interval: PitIntervalSnapshot;
  dataHash: string;
  seed: number;
  benchmarks: PitBenchmarkRow[];
  supervisedPolicy: { targetBoundary: 'strictly-before-origin'; embargoDays: number; eligibleRows: number; excludedUnresolvedTargets: number; excludedByEmbargo: number };
  candidate?: {
    id: PitCandidateId;
    median: number;
    absLogError: number;
    selectedParameter: string;
    innerTrainingEnd: string;
    sensitivity: { parameter: string; median: number; absLogError: number }[];
    pathDiagnostics?: { source: PathDiagnostics; generated: PathDiagnostics; method: string; simulations: number; comparisons: { method: string; diagnostics: PathDiagnostics }[]; terminalQuantiles: { q05:number;q10:number;q50:number;q90:number;q95:number;scale:number }; empiricalTerminalQuantiles:{q05:number;q10:number;q50:number;q90:number;q95:number} };
  };
}

export interface PitSkipRecord { originDate: string; horizonDays: number; reason: string }
export interface PointInTimeResult { origins: PitOriginRecord[]; skips: PitSkipRecord[] }

interface MaturedError { originDate: string; targetDate: string; absLogError: number }

/** Daily closes are treated as observable after their UTC date closes. Thus a
 * forecast made after the origin close may fit through that origin, but never
 * consumes a later row. Calibration targets must be strictly before origin. */
export function runPointInTimeBenchmark(input: {
  ohlcv: OHLCVData[];
  horizons?: readonly number[];
  originStart?: string;
  spacingDays?: number;
  seed?: number;
  candidate?: PitCandidateId;
}): PointInTimeResult {
  const rows = [...input.ohlcv].sort((a, b) => a.date.localeCompare(b.date));
  const horizons = input.horizons ?? PIT_HORIZONS;
  const spacing = input.spacingDays ?? 30;
  const seed = input.seed ?? PIT_SEED;
  const origins: PitOriginRecord[] = [];
  const skips: PitSkipRecord[] = [];
  const errorsByHorizon = new Map<number, MaturedError[]>();
  let previousCoefficients: PowerLawFitCoefficients | null = null;

  for (let originIndex = 0; originIndex < rows.length; originIndex += spacing) {
    const origin = rows[originIndex];
    if (input.originStart && origin.date < input.originStart) continue;
    const training = rows.slice(0, originIndex + 1);
    const coefficients = fitPowerLawCoefficients(training);
    for (const horizonDays of horizons) {
      const target = rows[originIndex + horizonDays];
      if (!target) { skips.push({ originDate: origin.date, horizonDays, reason: 'target-not-yet-observed' }); continue; }
      if (!coefficients) { skips.push({ originDate: origin.date, horizonDays, reason: 'insufficient-structural-training' }); continue; }
      const matured = (errorsByHorizon.get(horizonDays) ?? []).filter(error => error.targetDate < origin.date);
      const allPriorExamples = errorsByHorizon.get(horizonDays) ?? [];
      const embargoBoundary = new Date(utcDate(origin.date).getTime() - horizonDays * 86_400_000).toISOString().slice(0, 10);
      const embargoed = matured.filter(error => error.originDate >= embargoBoundary);
      const supervisedPolicy = { targetBoundary: 'strictly-before-origin' as const, embargoDays: horizonDays, eligibleRows: matured.length - embargoed.length, excludedUnresolvedTargets: allPriorExamples.length - matured.length, excludedByEmbargo: embargoed.length };
      const interval = intervalSnapshot(matured);
      const reconstructed = forecastWithPowerLawCoefficients(coefficients, utcDate(target.date), origin.close, utcDate(origin.date));
      const forecasts: [PitBenchmarkId, number][] = [
        ['reconstructed-current-policy', reconstructed],
        ['naive-current-price', origin.close],
        ['gbm-driftless', origin.close],
        ['gbm-recent-drift', recentDriftForecast(rows, originIndex, horizonDays)],
        ['ma-trend-20-50-200', maTrendForecast(rows, originIndex, horizonDays)],
      ];
      const benchmarks = forecasts.filter((item): item is [PitBenchmarkId, number] => Number.isFinite(item[1]) && item[1] > 0).map(([modelId, median]) => ({
        modelId, median, actual: target.close, absLogError: Math.abs(Math.log(median / target.close)),
      }));
      const currentError = benchmarks.find(row => row.modelId === 'reconstructed-current-policy')!;
      (errorsByHorizon.get(horizonDays) ?? errorsByHorizon.set(horizonDays, []).get(horizonDays)!).push({ originDate: origin.date, targetDate: target.date, absLogError: currentError.absLogError });
      const candidate = input.candidate ? buildCandidate({ id: input.candidate, rows, originIndex, horizonDays, targetClose: target.close, coefficients, previousCoefficients, reconstructed, seed }) : undefined;
      origins.push({
        originDate: origin.date, targetDate: target.date, horizonDays,
        trainingStart: training[0].date, trainingEnd: training.at(-1)!.date, trainingRows: training.length,
        lastKnownTargetDate: interval.lastKnownTargetDate, coefficients, interval,
        dataHash: hashRows(training), seed, benchmarks, candidate, supervisedPolicy,
      });
    }
    if (coefficients) previousCoefficients = coefficients;
  }
  return { origins, skips };
}

function buildCandidate(input: { id: PitCandidateId; rows: OHLCVData[]; originIndex: number; horizonDays: number; targetClose: number; coefficients: PowerLawFitCoefficients; previousCoefficients: PowerLawFitCoefficients | null; reconstructed: number; seed: number }): NonNullable<PitOriginRecord['candidate']> {
  const origin = input.rows[input.originIndex];
  const targetDate = input.rows[input.originIndex + input.horizonDays].date;
  if (input.id === 'structural-shrinkage') {
    const anchor = input.previousCoefficients ?? input.coefficients;
    const variants = STRUCTURAL_SHRINKAGE_GRID.map(weight => {
      const coefficients = blendCoefficients(anchor, input.coefficients, weight);
      const median = forecastWithPowerLawCoefficients(coefficients, utcDate(targetDate), origin.close, utcDate(origin.date));
      return { parameter: `refitWeight=${weight}`, median, absLogError: Math.abs(Math.log(median / input.targetClose)) };
    });
    const inner = structuralInnerWalkForward(input.rows, input.originIndex, input.horizonDays);
    const selectedParameter = inner.losses.sort((a,b)=>a.male-b.male||a.parameter.localeCompare(b.parameter))[0]?.parameter ?? 'refitWeight=0.5';
    const selected = variants.find(row=>row.parameter===selectedParameter)!;
    return { id: input.id, ...selected, selectedParameter, innerTrainingEnd: inner.trainingEnd, sensitivity: variants };
  }
  const observations = input.rows.slice(0, input.originIndex + 1).map(row => ({ date: row.date, residual: Math.log(row.close / fittedBasePowerLawPrice(input.coefficients, daysSinceGenesis(utcDate(row.date)))) }));
  const fits = STATE_SPACE_PARAMETER_GRID.map(parameters => fitLocalLevelResidualModel(observations, parameters));
  const innerState = stateSpaceInnerWalkForward(input.rows, input.originIndex, input.horizonDays);
  const selectedIndex = innerState.losses.sort((a,b)=>a.male-b.male||a.index-b.index)[0]?.index ?? 1;
  const selectedFit = fits[selectedIndex];
  if (input.id === 'state-space-residual') {
    const variants = fits.map((fit, index) => { const residual = forecastStateSpaceResidual(fit, input.horizonDays).at(-1)!.mean; const base = fittedBasePowerLawPrice(input.coefficients, daysSinceGenesis(utcDate(targetDate))); const median = base * Math.exp(residual); return { parameter: `grid=${index}`, median, absLogError: Math.abs(Math.log(median / input.targetClose)) }; });
    const selected = variants[selectedIndex];
    return { id: input.id, ...selected, selectedParameter: selected.parameter, innerTrainingEnd: innerState.trainingEnd, sensitivity: variants };
  }
  const source = selectedFit.innovations;
  const methods = ['current-recent-window','moving-block','volatility-regime','state-space'] as const;
  const powerLawResiduals=observations.map(row=>row.residual!).filter(Number.isFinite);
  const productionInnovations=powerLawResiduals.slice(1).map((value,index)=>value-powerLawResiduals[index]).slice(-730);
  const generatedByMethod = methods.map((method,index) => generateOriginSafeInnovations({ innovations: method==='current-recent-window'?productionInnovations:source, horizonDays: input.horizonDays, simulations: 64, blockLength: method==='current-recent-window'?14:Math.max(7, input.horizonDays), seed: input.seed + input.originIndex + input.horizonDays + index, method:method==='current-recent-window'?'moving-block':method, stateSpaceFit: selectedFit }));
  const productionDailyVol=Math.sqrt(mean(productionInnovations.map(value=>value*value)));
  generatedByMethod[0].paths=generatedByMethod[0].paths.map(path=>{const vol=Math.sqrt(mean(path.map(value=>value*value)));const scale=vol>0?productionDailyVol/vol:1;return path.map(value=>value*scale);});
  const generated = generatedByMethod[2];
  const aggregateDiagnostics = (paths:number[][]) => averageDiagnostics(paths.map(computePathDiagnostics));
  const empiricalSums=contiguousSums(source,input.horizonDays);
  const empiricalQuantiles=fiveQuantiles(empiricalSums);
  const rawTerminals=generated.paths.map(path=>path.reduce((sum,value)=>sum+value,0));
  const rawQuantiles=fiveQuantiles(rawTerminals);
  const scaledPaths = generated.paths.map((path,index)=>{const calibrated=mapTerminal(rawTerminals[index],rawQuantiles,empiricalQuantiles);const copy=[...path];copy[copy.length-1]+=calibrated-rawTerminals[index];return copy;});
  const terminals = scaledPaths.map(path=>path.reduce((sum,value)=>sum+value,0)).sort((a,b)=>a-b);
  const diagnostics = { source: computePathDiagnostics(source), generated: aggregateDiagnostics(scaledPaths), method: 'volatility-regime', simulations: generated.paths.length, comparisons: generatedByMethod.map((item,index)=>({method:methods[index],diagnostics:aggregateDiagnostics(item.paths)})), terminalQuantiles:{...fiveQuantiles(terminals),scale: empiricalQuantiles.q90-empiricalQuantiles.q10}, empiricalTerminalQuantiles:empiricalQuantiles };
  return { id: input.id, median: input.reconstructed, absLogError: Math.abs(Math.log(input.reconstructed / input.targetClose)), selectedParameter: `method=${generated.metadata.method};block=${generated.metadata.blockLength}`, innerTrainingEnd: selectedFit.trainingEndDate!, sensitivity: [], pathDiagnostics: diagnostics };
}

function innerIndices(outer:number,h:number):number[]{const last=outer-h-1;if(last<INNER_MIN_TRAINING_ROWS)return[];const first=Math.max(INNER_MIN_TRAINING_ROWS,last-(INNER_WALK_FORWARD_FOLDS-1)*h);const xs:number[]=[];for(let i=first;i<=last;i+=h)xs.push(i);return xs.slice(-INNER_WALK_FORWARD_FOLDS);}
function structuralInnerWalkForward(rows:OHLCVData[],outer:number,h:number){const folds=innerIndices(outer,h);const losses=STRUCTURAL_SHRINKAGE_GRID.map(weight=>({parameter:`refitWeight=${weight}`,male:mean(folds.map(i=>{const fit=fitPowerLawCoefficients(rows.slice(0,i+1));const anchor=fitPowerLawCoefficients(rows.slice(0,Math.max(INNER_MIN_TRAINING_ROWS,i-h)+1));if(!fit||!anchor)return Number.POSITIVE_INFINITY;const median=forecastWithPowerLawCoefficients(blendCoefficients(anchor,fit,weight),utcDate(rows[i+h].date),rows[i].close,utcDate(rows[i].date));return Math.abs(Math.log(median/rows[i+h].close));}))}));return{losses,trainingEnd:folds.length?rows[folds.at(-1)!+h].date:rows[Math.max(0,outer-h-1)].date};}
function stateSpaceInnerWalkForward(rows:OHLCVData[],outer:number,h:number){const folds=innerIndices(outer,h);const losses=STATE_SPACE_PARAMETER_GRID.map((parameters,index)=>({index,male:mean(folds.map(i=>{const fitCoefficients=fitPowerLawCoefficients(rows.slice(0,i+1));if(!fitCoefficients)return Number.POSITIVE_INFINITY;const observations=rows.slice(0,i+1).map(row=>({date:row.date,residual:Math.log(row.close/fittedBasePowerLawPrice(fitCoefficients,daysSinceGenesis(utcDate(row.date))))}));const fit=fitLocalLevelResidualModel(observations,parameters);const residual=forecastStateSpaceResidual(fit,h).at(-1)!.mean;const median=fittedBasePowerLawPrice(fitCoefficients,daysSinceGenesis(utcDate(rows[i+h].date)))*Math.exp(residual);return Math.abs(Math.log(median/rows[i+h].close));}))}));return{losses,trainingEnd:folds.length?rows[folds.at(-1)!+h].date:rows[Math.max(0,outer-h-1)].date};}
function mean(xs:number[]):number{return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:Number.POSITIVE_INFINITY;}
function averageDiagnostics(rows:PathDiagnostics[]):PathDiagnostics{const keys=Object.keys(rows[0]??computePathDiagnostics([])) as (keyof PathDiagnostics)[];return Object.fromEntries(keys.map(k=>[k,rows.length?rows.reduce((s,r)=>s+r[k],0)/rows.length:0])) as unknown as PathDiagnostics;}
function contiguousSums(values:readonly number[],h:number){const sums:number[]=[];for(let i=0;i+h<=values.length;i++)sums.push(values.slice(i,i+h).reduce((a,b)=>a+b,0));return sums;}
function fiveQuantiles(values:number[]){return{q05:quantile([...values].sort((a,b)=>a-b),.05)??0,q10:quantile([...values].sort((a,b)=>a-b),.1)??0,q50:quantile([...values].sort((a,b)=>a-b),.5)??0,q90:quantile([...values].sort((a,b)=>a-b),.9)??0,q95:quantile([...values].sort((a,b)=>a-b),.95)??0};}
function mapTerminal(value:number,from:ReturnType<typeof fiveQuantiles>,to:ReturnType<typeof fiveQuantiles>){const points:[[number,number],[number,number],[number,number]]=[[from.q10,to.q10],[from.q50,to.q50],[from.q90,to.q90]];const [a,b]=value<=from.q50?[points[0],points[1]]:[points[1],points[2]];return a[1]+(value-a[0])*(b[1]-a[1])/(b[0]-a[0]||1);}

function blendCoefficients(anchor: PowerLawFitCoefficients, refit: PowerLawFitCoefficients, weight: number): PowerLawFitCoefficients { return { coefficient: Math.exp((1-weight)*Math.log(anchor.coefficient)+weight*Math.log(refit.coefficient)), exponent:(1-weight)*anchor.exponent+weight*refit.exponent, sinAmplitude:(1-weight)*anchor.sinAmplitude+weight*refit.sinAmplitude, cosAmplitude:(1-weight)*anchor.cosAmplitude+weight*refit.cosAmplitude, cycleDays:refit.cycleDays }; }

function intervalSnapshot(errors: MaturedError[]): PitIntervalSnapshot {
  const values = errors.map(row => row.absLogError).sort((a, b) => a - b);
  return { maturedErrors: values.length, lastKnownTargetDate: errors.map(e => e.targetDate).sort().at(-1) ?? null,
    q80AbsLogError: quantile(values, .8), q90AbsLogError: quantile(values, .9), q95AbsLogError: quantile(values, .95) };
}
function quantile(xs: number[], q: number): number | null { if (!xs.length) return null; return xs[Math.floor((xs.length - 1) * q)]; }
function hashRows(rows: OHLCVData[]): string { return createHash('sha256').update(JSON.stringify(rows.map(r => [r.date,r.open,r.high,r.low,r.close,r.volume]))).digest('hex'); }
function utcDate(date: string): Date { return new Date(`${date}T00:00:00Z`); }
function meanClose(rows: OHLCVData[], end: number, window: number): number { const xs=rows.slice(Math.max(0,end-window+1),end+1); return xs.reduce((s,r)=>s+r.close,0)/xs.length; }
function recentDriftForecast(rows: OHLCVData[], i: number, h: number): number { const start=Math.max(0,i-90); return rows[i].close*Math.exp(Math.log(rows[i].close/rows[start].close)/(i-start||1)*h); }
function maTrendForecast(rows: OHLCVData[], i: number, h: number): number { if(i<220)return NaN; const trend=.55*Math.log(meanClose(rows,i,20)/meanClose(rows,i,50))/30+.45*Math.log(meanClose(rows,i,50)/meanClose(rows,i,200))/150; return rows[i].close*Math.exp(Math.max(-.006,Math.min(.006,trend))*h); }
