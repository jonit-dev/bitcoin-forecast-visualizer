import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { evaluateFreshness } from '../../../scripts/check-data-freshness';
import { latestSourceRow } from '../../../scripts/build-feature-table';
import { MACRO_SERIES, buildObservationsUrl } from '../../../scripts/update-macro-data.mjs';
import { assertMinimumFeatureCoverage } from '../../../scripts/validate-feature-table';
import { reconstructVintage } from '../../../scripts/reconstruct-vintage.mjs';
import { requireEnv } from '../../../scripts/lib/env.mjs';
import { mergeByKey } from '../../../scripts/lib/mergeRows.mjs';
import { appendVintageRecords } from '../../../scripts/lib/vintageStore.mjs';
import { SOURCE_FRESHNESS_CAP_DAYS } from '../../../scripts/lib/sourceFreshness.mjs';

describe('script guardrails', () => {
  it('should reject negative stablecoin supply', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stablecoin-validator-'));
    const path = join(dir, 'stablecoin-history.json');
    writeFileSync(path, JSON.stringify({
      metadata: { source: 'DeFiLlama Stablecoins API' },
      rows: Array.from({ length: 365 }, (_, index) => {
        const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
        return {
          date,
          source: 'DeFiLlama Stablecoins API',
          availableAfter: new Date(Date.UTC(2025, 0, 2 + index)).toISOString(),
          metrics: { totalSupplyUSD: index === 100 ? -1 : 1000 + index },
        };
      }),
    }));

    const result = spawnSync('node', ['scripts/validate-stablecoin-data.mjs', path], { cwd: process.cwd(), encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain('invalid stablecoin supply');
  });

  it('should reject direct UI feature-table imports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-import-guard-'));
    const path = join(dir, 'Fixture.tsx');
    writeFileSync(path, "import featureTable from '../src/data/feature-table.json';\nexport function Fixture() { return null; }\n");

    const result = spawnSync('node', ['scripts/guard-ui-imports.mjs', path], { cwd: process.cwd(), encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain('feature-table.json must not be imported');
  });

  it('should pass current UI import guard', () => {
    expect(() => execFileSync('node', ['scripts/guard-ui-imports.mjs'], { cwd: process.cwd() })).not.toThrow();
  });

  it('should preserve the optional derivatives cache when Binance is unavailable', () => {
    const script = readFileSync('scripts/update-derivatives-data.mjs', 'utf8');
    const failureHandler = script.slice(script.indexOf('main().catch'));
    expect(failureHandler).toContain('preserving existing cache');
    expect(failureHandler).not.toContain('rows: []');
    expect(failureHandler).not.toContain('process.exitCode = 1');
  });

  it('should give the production watchdog a working default deployment URL', () => {
    const workflow = readFileSync('.github/workflows/market-data-watchdog.yml', 'utf8');
    expect(workflow).toContain("MARKET_DATA_BASE_URL: ${{ vars.MARKET_DATA_BASE_URL || 'https://bitcoin-forecast-visualizer.pages.dev' }}");
  });

  it('should restore an optional data cache when its updater fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'optional-update-'));
    const cache = join(dir, 'cache.json');
    const updater = join(dir, 'fail.mjs');
    writeFileSync(cache, '{"rows":[{"date":"2026-07-01"}]}\n');
    writeFileSync(updater, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(cache)}, '{"rows":[]}\\n');\nprocess.exit(1);\n`);

    const result = spawnSync('node', ['scripts/run-optional-update.mjs', cache, process.execPath, updater], { cwd: process.cwd(), encoding: 'utf8' });
    const restored = readFileSync(cache, 'utf8');
    rmSync(dir, { recursive: true, force: true });

    expect(result.status).toBe(0);
    expect(restored).toBe('{"rows":[{"date":"2026-07-01"}]}\n');
    expect(`${result.stderr}${result.stdout}`).toContain('preserved previous cache');
  });

  it('should retain an existing row when the incoming payload omits its key', () => {
    const merged = mergeByKey(
      [{ date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 2 }],
      [{ date: '2026-01-02', value: 3 }],
      'date'
    );

    expect(merged).toHaveLength(2);
    expect(merged.map(row => row.date)).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('should prefer the incoming value when both payloads carry the same key', () => {
    const merged = mergeByKey([{ date: '2026-01-01', value: 1 }], [{ date: '2026-01-01', value: 9 }], 'date');
    expect(merged[0].value).toBe(9);
  });

  it('should fail validation when a declared feature falls below its minimum coverage', () => {
    const rows = Array.from({ length: 29 }, (_, index) => ({
      features: {
        futuresOpenInterestUSD: 100 + index,
        futuresOpenInterestToMarketCap: 0.01,
      },
    }));

    expect(() => assertMinimumFeatureCoverage(rows)).toThrow(/feature=futuresOpenInterestUSD count=29 minimum=30/);
  });

  it('should retain an older open-interest metric when a shorter vendor window omits it', () => {
    const merged = mergeByKey(
      [{ date: '2026-01-01', metrics: { openInterestUSD: 100, fundingRateDailySum: 1 } }],
      [{ date: '2026-01-01', metrics: { fundingRateDailySum: 2 } }],
      'date'
    );
    expect(merged[0].metrics).toEqual({ openInterestUSD: 100, fundingRateDailySum: 2 });
  });

  it('should throw a named error when FRED_API_KEY is absent', () => {
    const previous = process.env.FRED_API_KEY;
    delete process.env.FRED_API_KEY;
    expect(() => requireEnv('FRED_API_KEY')).toThrow(/MissingEnvironmentVariableError|FRED_API_KEY.*update:macro/);
    if (previous === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = previous;
  });

  it('should request an observation start of 2010-07-17 for every macro series', () => {
    for (const [seriesId] of MACRO_SERIES) {
      const url = buildObservationsUrl(seriesId, 'fixture-key', '2026-08-02');
      expect(url.searchParams.get('series_id')).toBe(seriesId);
      expect(url.searchParams.get('observation_start')).toBe('2010-07-17');
      expect(url.searchParams.get('api_key')).toBe('fixture-key');
      expect(url.searchParams.get('realtime_start')).toBe('2026-08-02');
    }
  });

  it('should wire the FRED secret into the data-only daily workflow', () => {
    const workflow = readFileSync('.github/workflows/forecast-data-update.yml', 'utf8');
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(workflow).toContain('FRED_API_KEY: ${{ secrets.FRED_API_KEY }}');
    expect(workflow).not.toContain('wrangler pages deploy');
    expect(workflow).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(packageJson.scripts['update:forecast-data']).toContain('node scripts/update-macro-data.mjs');
    expect(packageJson.scripts['update:forecast-data']).not.toContain('run-optional-update.mjs src/data/macro-history.json');
  });

  it('should fail freshness when a source exceeds its declared per-source cap', () => {
    const result = evaluateFreshness({
      onchain: { status: 'fresh', latestDate: '2026-07-28', lagDays: 5, required: true },
    });
    expect(result.failures).toEqual(['onchain lag=5 cap=3d status=fresh']);
    expect(SOURCE_FRESHNESS_CAP_DAYS).toMatchObject({ cot: 10, macro: 45, etf: 5, onchain: 3 });
  });

  it('should append one vintage record per observation without rewriting prior records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vintage-store-'));
    appendVintageRecords('TEST', [{ asOfDate: '2024-01-01', observedAt: '2024-01-02', value: 1 }], dir);
    const before = readFileSync(join(dir, 'TEST.ndjson'), 'utf8');
    appendVintageRecords('TEST', [{ asOfDate: '2024-01-01', observedAt: '2024-02-02', value: 2 }], dir);
    const after = readFileSync(join(dir, 'TEST.ndjson'), 'utf8');
    rmSync(dir, { recursive: true, force: true });

    expect(after.startsWith(before)).toBe(true);
    expect(after.trim().split('\n')).toHaveLength(2);
  });

  it('should record a missing reason when a source exceeds its forward-fill cap', () => {
    const lookup = latestSourceRow(
      [{ date: '2026-07-01', metrics: { mvrv: 1.2 } }],
      '2026-07-05',
      '2026-07-06',
      3,
      'on-chain'
    );
    expect(lookup.row).toBeNull();
    expect(lookup.reason).toContain('exceeds 3-day forward-fill cap');
  });

  it('should reconstruct pre-revision and post-revision vintage values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vintage-reconstruct-'));
    appendVintageRecords('REVISION', [
      { asOfDate: '2024-01-01', observedAt: '2024-01-02T00:00:00Z', value: 10 },
      { asOfDate: '2024-01-01', observedAt: '2024-03-02T00:00:00Z', value: 20 },
    ], dir);

    expect(reconstructVintage('REVISION', '2024-02-01', dir)[0].value).toBe(10);
    expect(reconstructVintage('REVISION', '2024-04-01', dir)[0].value).toBe(20);

    appendVintageRecords('macro-WALCL', [
      { asOfDate: '2024-01-01', observedAt: '2024-01-02T00:00:00Z', value: 30 },
    ], dir);
    expect(reconstructVintage('WALCL', '2024-02-01', dir)[0].value).toBe(30);
    rmSync(dir, { recursive: true, force: true });
  });

  it('should never shrink a cache file across two updater runs for every cache family', () => {
    const updaters = [
      ['BTC', 'scripts/update-btc-data.mjs'],
      ['MACRO', 'scripts/update-macro-data.mjs'],
      ['DERIVATIVES', 'scripts/update-derivatives-data.mjs'],
      ['ONCHAIN', 'scripts/update-onchain-data.mjs'],
      ['ETF_FLOW', 'scripts/update-etf-flow-data.mjs'],
      ['COT', 'scripts/update-cot-data.mjs'],
      ['STABLECOIN', 'scripts/update-stablecoin-data.mjs'],
    ] as const;

    for (const [family, updater] of updaters) {
      const source = readFileSync(updater, 'utf8');
      expect(source).toContain('mergeByKey');
      expect(source).toContain('appendVintageRecords');
      const existing = [{ date: '2024-01-01', family }, { date: '2024-01-02', family }];
      const shorterIncoming = [{ date: '2024-01-02', family, revised: true }];
      expect(mergeByKey(existing, shorterIncoming, 'date').length).toBeGreaterThanOrEqual(existing.length);
    }
  });
});
