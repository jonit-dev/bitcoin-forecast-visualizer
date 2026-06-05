import featureTable from '../src/data/feature-table.json';

const MS_PER_DAY = 86400000;

function main(): void {
  const rows = featureTable as any[];
  if (!Array.isArray(rows)) throw new Error('feature-table.json must be an array');
  if (rows.length < 365) throw new Error(`feature table row count too low: ${rows.length}`);

  let previousDate: string | null = null;
  let maxSourceDate = '';
  let totalMissingReasons = 0;

  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`bad feature row date: ${row.date}`);
    if (previousDate && daysBetween(previousDate, row.date) !== 1) {
      throw new Error(`feature date gap between ${previousDate} and ${row.date}`);
    }
    if (!row.features || typeof row.features !== 'object') throw new Error(`missing features on ${row.date}`);
    if (!row.sourceDates || typeof row.sourceDates !== 'object') throw new Error(`missing sourceDates on ${row.date}`);

    const allowedLatestSourceDate = addUtcDays(row.date, -1);
    for (const [feature, sourceDate] of Object.entries(row.sourceDates)) {
      if (typeof sourceDate !== 'string' || sourceDate > allowedLatestSourceDate) {
        throw new Error(`lookahead feature ${feature} on ${row.date}: sourceDate=${sourceDate}`);
      }
      if (sourceDate > maxSourceDate) maxSourceDate = sourceDate;
    }
    for (const [feature, value] of Object.entries(row.features)) {
      if (!Number.isFinite(value)) throw new Error(`non-finite feature ${feature} on ${row.date}`);
    }
    totalMissingReasons += Object.keys(row.missingFeatureReasons || {}).length;
    previousDate = row.date;
  }

  console.log('[Feature validation] OK');
  console.log(
    [
      `rows=${rows.length}`,
      `first=${rows[0].date}`,
      `last=${rows.at(-1).date}`,
      `maxSourceDateUsed=${maxSourceDate}`,
      `latestAllowedSourceDate=${addUtcDays(rows.at(-1).date, -1)}`,
      `missingFeatureReasons=${totalMissingReasons}`,
    ].join('  ')
  );
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / MS_PER_DAY);
}

function addUtcDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().split('T')[0];
}

main();
