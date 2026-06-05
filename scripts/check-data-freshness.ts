import sourceFreshness from '../src/data/source-freshness.json';

const REQUIRED_MAX_LAG_DAYS = 7;

function main(): void {
  const freshness = sourceFreshness as any;
  const failures: string[] = [];
  const warnings: string[] = [];
  const forceStale = process.argv.includes('--fixture-stale-required');

  for (const [name, source] of Object.entries<any>(freshness.sources || {})) {
    if (source.required && (forceStale || source.lagDays === null || source.lagDays > REQUIRED_MAX_LAG_DAYS || source.status === 'missing')) {
      failures.push(`${name} lag=${source.lagDays} status=${source.status}`);
    } else if (!source.required && source.status !== 'available' && source.status !== 'fresh') {
      warnings.push(`${name} status=${source.status}`);
    }
  }

  for (const warning of warnings) console.warn(`[Freshness] optional warning: ${warning}`);
  if (failures.length > 0) {
    console.error(`[Freshness] required stale or missing: ${failures.join('; ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[Freshness] OK generatedAt=${freshness.generatedAt}`);
}

main();
