import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadMarketData, type MarketAssetId } from '../src/lib/api';
import { CONFIDENCE_Z_SCORES } from '../src/lib/data';
import { FORECAST_PATH_GENERATOR_VERSION, forecastDataVersion, forecastPathSeed } from '../src/lib/forecastPathSeed';
import { buildMarketForecast } from '../src/lib/marketForecast';

const candidate = process.argv.includes('--candidate');
const policy = candidate ? 'prefix-stable-v1' : 'production-baseline';
const label = candidate ? 'candidate' : 'baseline';
const assets: MarketAssetId[] = ['btc', 'sp500', 'gold'];
const pairs = [[30, 90], [90, 180], [180, 365]] as const;
const commit = (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'unknown'; } })();

const results = assets.flatMap((asset) => {
  const data = loadMarketData(asset);
  const evaluationData = { ...data, ohlcv: data.ohlcv.slice(-1800) };
  return pairs.map(([shortHorizon, longHorizon]) => {
    const build = (horizon: number) => buildMarketForecast(asset, evaluationData, horizon, CONFIDENCE_Z_SCORES[0.95], { pathPolicy: policy }).displayData.filter((row) => row.isForecast);
    const shortRows = build(shortHorizon);
    const longRows = build(longHorizon);
    let maximumRelativeDifference = 0;
    let firstMismatchDate: string | null = null;
    let mismatchCount = 0;
    for (let index = 0; index < shortRows.length; index++) {
      const left = shortRows[index].stochasticTraces?.[0];
      const right = longRows[index]?.stochasticTraces?.[0];
      const relative = Math.abs(left - right) / Math.max(1, Math.abs(left));
      if (shortRows[index].date !== longRows[index]?.date || relative > 1e-12) {
        mismatchCount++;
        firstMismatchDate ??= shortRows[index].date;
        maximumRelativeDifference = Math.max(maximumRelativeDifference, relative);
      }
    }
    const dataHash = forecastDataVersion(evaluationData.ohlcv);
    const methodId = asset === 'btc' ? 'power-law-residual-block-bootstrap-14d' : 'generic-return-block-bootstrap-10d';
    const seed = candidate ? forecastPathSeed({ assetId: asset, originDate: evaluationData.ohlcv.at(-1)!.date, dataVersion: dataHash, methodId, generatorVersion: FORECAST_PATH_GENERATOR_VERSION }, 0) : asset === 'btc' ? `0xB17C01A + ${shortHorizon} * 131 + anchorIndex` : `0x5A500 + ${shortHorizon} * 97 + ${evaluationData.ohlcv.length}`;
    return { asset, origin: evaluationData.ohlcv.at(-1)!.date, dataHash, method: policy, methodId, generatorVersion: candidate ? FORECAST_PATH_GENERATOR_VERSION : 'production-baseline', seed, primaryTraceIndex: shortRows[0]?.primaryTraceIndex ?? (asset === 'gold' ? 'full-horizon-selected' : 0), shortHorizon, longHorizon, mismatchCount, maximumRelativeDifference, firstMismatchDate, shortTerminal: shortRows.at(-1)?.stochasticTraces?.[0], longValueAtShortTerminal: longRows[shortRows.length - 1]?.stochasticTraces?.[0] };
  });
});

const invariant = results.every((row) => row.mismatchCount === 0);
const report = { generatedAt: new Date().toISOString(), gitCommit: commit, policy, configHash: createHash('sha256').update(`${policy}|${FORECAST_PATH_GENERATOR_VERSION}|fixed-gold-selection-14d`).digest('hex'), verdict: candidate && invariant ? 'needs-more-data' : candidate ? 'reject' : 'baseline-redraw-confirmed', invariant, note: candidate && invariant ? 'Prefix gate passes; statistical rolling-origin non-inferiority and backtest gates are required before runtime promotion.' : undefined, results };
mkdirSync('docs/reports/results', { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const stem = `docs/reports/results/forecast-path-prefix-${label}-${date}`;
writeFileSync(`${stem}.json`, JSON.stringify(report, null, 2) + '\n');
writeFileSync(`${stem}.md`, `# Forecast path prefix ${label}\n\n- Generated: ${report.generatedAt}\n- Commit: \`${commit}\`\n- Policy: \`${policy}\`\n- Config hash: \`${report.configHash}\`\n- Verdict: **${report.verdict}**\n\n| Asset | Pair | Mismatches | Max relative difference | First mismatch |\n|---|---:|---:|---:|---|\n${results.map((row) => `| ${row.asset} | ${row.shortHorizon}→${row.longHorizon} | ${row.mismatchCount} | ${row.maximumRelativeDifference} | ${row.firstMismatchDate ?? 'none'} |`).join('\n')}\n\n${report.note ?? ''}\n`);
console.log(JSON.stringify({ artifacts: [`${stem}.md`, `${stem}.json`], verdict: report.verdict, invariant }, null, 2));
