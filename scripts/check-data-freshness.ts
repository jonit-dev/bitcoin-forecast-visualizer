import sourceFreshness from '../src/data/source-freshness.json';
import vooHistory from '../src/data/voo-history.json';
import { pathToFileURL } from 'node:url';
import { SOURCE_FRESHNESS_CAP_DAYS } from './lib/sourceFreshness.mjs';

const MS_PER_DAY = 86400000;

function toUtcDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function diffUtcDays(fromDate: string, toDate: string): number {
  return Math.round((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / MS_PER_DAY);
}

export interface FreshnessSource {
  status: string;
  latestDate: string | null;
  lagDays: number | null;
  required: boolean;
}

export function evaluateFreshness(
  sources: Record<string, FreshnessSource>,
  forceStale = false
): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const [name, source] of Object.entries<any>(sources)) {
    const maxLagDays = SOURCE_FRESHNESS_CAP_DAYS[name] ?? 3;
    const stale = forceStale || source.lagDays === null || source.lagDays > maxLagDays || source.status === 'missing';
    if (source.required && stale) {
      failures.push(`${name} lag=${source.lagDays} cap=${maxLagDays}d status=${source.status}`);
    } else if (!source.required && stale) {
      warnings.push(`${name} lag=${source.lagDays} cap=${maxLagDays}d status=${source.status}`);
    }
  }

  return { failures, warnings };
}

function main(): void {
  const freshness = sourceFreshness as any;
  const latestVoo = (vooHistory as any[]).at(-1)?.date ?? null;
  const todayUtc = toUtcDateKey(new Date());
  const configuredSources = Object.fromEntries(
    Object.entries<any>(freshness.sources || {}).map(([name, source]) => [
      name,
      {
        ...source,
        lagDays: source.latestDate ? diffUtcDays(source.latestDate, todayUtc) : null,
      },
    ])
  );
  const sources = {
    ...configuredSources,
    voo: {
      status: latestVoo ? 'fresh' : 'missing',
      latestDate: latestVoo,
      lagDays: latestVoo ? diffUtcDays(latestVoo, todayUtc) : null,
      required: true,
    },
  } as Record<string, FreshnessSource>;
  const { failures, warnings } = evaluateFreshness(
    sources,
    process.argv.includes('--fixture-stale-required')
  );

  for (const warning of warnings) console.warn(`[Freshness] optional warning: ${warning}`);
  if (failures.length > 0) {
    console.error(`[Freshness] required stale or missing: ${failures.join('; ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[Freshness] OK generatedAt=${freshness.generatedAt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
