import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

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
});
