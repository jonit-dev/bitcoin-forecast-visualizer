import { describe, expect, it } from 'vitest';
import type { OHLCVData } from '../api';
import { purgeAndEmbargoResidualRows, purgeResidualRowsForEvaluation, type ResidualDatasetRow } from '../featureExperimentDataset';
import { runPointInTimeBenchmark } from '../pointInTimeForecast';

describe('point-in-time forecast', () => {
  it('should exclude labels unresolved at evaluation origin', () => {
    const rows = ['2024-01-01','2024-01-05','2024-01-10'].map((targetDate,i):ResidualDatasetRow=>({originDate:`2023-12-0${i+1}`,targetDate,horizonDays:30,actualClose:1,baselineMedian:1,targetResidualLog:0,features:{}}));
    const purged = purgeResidualRowsForEvaluation(rows, '2024-01-05', 2);
    expect(purged.rows.map(row=>row.targetDate)).toEqual(['2024-01-01']);
    expect(purged.lastKnownTargetDate).toBe('2024-01-01');
    expect(purged.rows.every(row=>row.targetDate<'2024-01-05')).toBe(true);
  });

  it('should apply a horizon-aware embargo at fold boundaries', () => {
    const rows: ResidualDatasetRow[] = [{originDate:'2024-01-25',targetDate:'2024-01-30',horizonDays:5,actualClose:1,baselineMedian:1,targetResidualLog:0,features:{}}];
    const purged = purgeAndEmbargoResidualRows(rows, '2024-02-01', 7);
    expect(purged.rows).toEqual([]);
    expect(purged.excludedByEmbargo).toBe(1);
    expect(() => purgeAndEmbargoResidualRows(rows, '2024-02-01', 7, 6)).toThrow(/at least horizonDays/);
  });

  it('should ignore a future price mutation', () => {
    const data = syntheticRows(1900);
    const options = { horizons:[14], originStart:data[1800].date, spacingDays:10 } as const;
    const before = runPointInTimeBenchmark({ohlcv:data,...options}).origins.filter(row=>row.originDate<data[1850].date).map(forecastProjection);
    const changed = data.map((row,i)=>i>=1850?{...row,open:row.open*9,high:row.high*9,low:row.low*9,close:row.close*9}:row);
    const after = runPointInTimeBenchmark({ohlcv:changed,...options}).origins.filter(row=>row.originDate<data[1850].date).map(forecastProjection);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('selects candidates only from inner walk-forward targets before the outer origin', () => {
    const data = syntheticRows(1900);
    for (const candidate of ['structural-shrinkage','state-space-residual'] as const) {
      const result = runPointInTimeBenchmark({ohlcv:data,horizons:[14],originStart:data[1850].date,spacingDays:25,candidate});
      expect(result.origins.every(row=>row.candidate!.innerTrainingEnd < row.originDate)).toBe(true);
      expect(result.origins.every(row=>row.candidate!.selectedParameter.length>0)).toBe(true);
    }
  });

  it('reports deterministic per-path generator comparisons and terminal quantiles', () => {
    const data=syntheticRows(1900); const options={ohlcv:data,horizons:[14],originStart:data[1870].date,spacingDays:20,candidate:'calibrated-jagged-path' as const,seed:42};
    const first=runPointInTimeBenchmark(options); const second=runPointInTimeBenchmark(options);
    expect(second).toEqual(first);
    const diagnostics=first.origins[0].candidate!.pathDiagnostics!;
    expect(diagnostics.comparisons.map(row=>row.method)).toEqual(['current-recent-window','moving-block','volatility-regime','state-space']);
    expect(diagnostics.terminalQuantiles.q10).toBeLessThanOrEqual(diagnostics.terminalQuantiles.q50);
    expect(diagnostics.terminalQuantiles.q50).toBeLessThanOrEqual(diagnostics.terminalQuantiles.q90);
  });
});

function syntheticRows(count:number):OHLCVData[]{ const start=Date.UTC(2015,0,1); return Array.from({length:count},(_,i)=>{const close=200*Math.pow(i+500,1.2)*(1+.04*Math.sin(i/120)); const date=new Date(start+i*86400000).toISOString().slice(0,10); return {date,open:close*.99,high:close*1.02,low:close*.98,close,volume:1000+i};}); }
function forecastProjection(row: ReturnType<typeof runPointInTimeBenchmark>['origins'][number]) { return { ...row, benchmarks: row.benchmarks.map(({actual: _actual, absLogError: _error, ...forecast})=>forecast), candidate: row.candidate ? { ...row.candidate, absLogError: 0, sensitivity: row.candidate.sensitivity.map(({absLogError:_error,...forecast})=>forecast) } : undefined }; }
