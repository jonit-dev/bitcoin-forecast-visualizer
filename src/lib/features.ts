import featureTable from '../data/feature-table.json';

export interface FeatureRow {
  date: string;
  features: Record<string, number>;
  sourceDates: Record<string, string>;
  missingFeatureReasons: Record<string, string>;
}

const rows = featureTable as FeatureRow[];
const byDate = new Map(rows.map(row => [row.date, row]));

export function getFeatureRows(): FeatureRow[] {
  return rows;
}

export function getFeatureRowByDate(date: string): FeatureRow | null {
  return byDate.get(date) ?? null;
}

export function getLatestFeatureRow(): FeatureRow | null {
  return rows.at(-1) ?? null;
}
