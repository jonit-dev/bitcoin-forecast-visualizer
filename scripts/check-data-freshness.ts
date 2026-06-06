import sourceFreshness from '../src/data/source-freshness.json';
import vooHistory from '../src/data/voo-history.json';

const REQUIRED_MAX_LAG_DAYS = 7;
const MS_PER_DAY = 86400000;

function toUtcDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function diffUtcDays(fromDate: string, toDate: string): number {
  return Math.round((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / MS_PER_DAY);
}

function main(): void {
  const freshness = sourceFreshness as any;
  const failures: string[] = [];
  const warnings: string[] = [];
  const forceStale = process.argv.includes('--fixture-stale-required');
  const latestVoo = (vooHistory as any[]).at(-1)?.date ?? null;
  const todayUtc = toUtcDateKey(new Date());
  const sources = {
    ...(freshness.sources || {}),
    voo: {
      status: latestVoo ? 'fresh' : 'missing',
      latestDate: latestVoo,
      lagDays: latestVoo ? diffUtcDays(latestVoo, todayUtc) : null,
      required: true,
    },
  };

  for (const [name, source] of Object.entries<any>(sources)) {
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
