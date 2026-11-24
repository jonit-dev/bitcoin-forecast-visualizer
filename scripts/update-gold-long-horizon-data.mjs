#!/usr/bin/env node
/**
 * Fetch and cache research-only monthly spot gold + US macro series (1970-present)
 * for evaluating long-horizon Gold valuation anchors (report-only).
 *
 * Sources:
 * - Spot gold monthly USD/oz: datahub.io/core/gold-prices
 * - CPIAUCSL (US CPI-U): FRED public graph CSV
 * - M2SL (US M2 money stock): FRED public graph CSV
 * - GS10 (10-Year Treasury constant maturity rate): FRED public graph CSV
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(ROOT, 'src/data/gold-long-horizon-monthly.json');

const SOURCES = {
  gold: 'https://datahub.io/core/gold-prices/_r/-/data/monthly.csv',
  cpi: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL',
  m2: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL',
  gs10: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GS10',
};

async function fetchCsv(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'bitcoin-forecast-visualizer-research/1.0' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  const text = await response.text();
  const sha256 = createHash('sha256').update(text).digest('hex');
  return { text, sha256 };
}

function parseMonthlySeries(csvText, valueLabel) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 10) {
    throw new Error(`Unexpectedly short CSV for ${valueLabel}: ${lines.length} lines`);
  }
  const map = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 2) continue;
    const rawDate = parts[0].trim();
    const rawVal = parts[1].trim();
    if (!rawVal || rawVal === '.') continue;
    const val = Number(rawVal);
    if (!Number.isFinite(val)) continue;
    const ymMatch = rawDate.match(/^(\d{4}-\d{2})/);
    if (!ymMatch) continue;
    map.set(ymMatch[1], val);
  }
  return map;
}

async function main() {
  const [goldRaw, cpiRaw, m2Raw, gs10Raw] = await Promise.all([
    fetchCsv(SOURCES.gold),
    fetchCsv(SOURCES.cpi),
    fetchCsv(SOURCES.m2),
    fetchCsv(SOURCES.gs10),
  ]);

  const goldMap = parseMonthlySeries(goldRaw.text, 'gold');
  const cpiMap = parseMonthlySeries(cpiRaw.text, 'cpi');
  const m2Map = parseMonthlySeries(m2Raw.text, 'm2');
  const gs10Map = parseMonthlySeries(gs10Raw.text, 'gs10');

  const months = [...goldMap.keys()]
    .filter((ym) => ym >= '1970-01')
    .sort();

  if (months.length < 500) {
    throw new Error(`Too few Gold months (${months.length}); aborting write.`);
  }

  const rows = months.map((ym) => ({
    ym,
    gold: goldMap.get(ym),
    cpi: cpiMap.has(ym) ? cpiMap.get(ym) : null,
    m2: m2Map.has(ym) ? m2Map.get(ym) : null,
    gs10: gs10Map.has(ym) ? gs10Map.get(ym) : null,
  }));

  // Verify consecutive monthly cadence with zero missing gold months
  for (let i = 1; i < rows.length; i += 1) {
    const [py, pm] = rows[i - 1].ym.split('-').map(Number);
    const [cy, cm] = rows[i].ym.split('-').map(Number);
    const diffMonths = (cy - py) * 12 + (cm - pm);
    if (diffMonths !== 1) {
      throw new Error(`Month gap detected between ${rows[i - 1].ym} and ${rows[i].ym}`);
    }
  }

  const missingMonths = {
    cpi: rows.filter((r) => r.cpi === null).map((r) => r.ym),
    m2: rows.filter((r) => r.m2 === null).map((r) => r.ym),
    gs10: rows.filter((r) => r.gs10 === null).map((r) => r.ym),
  };

  const payload = {
    metadata: {
      fetchedAt: new Date().toISOString(),
      rowCount: rows.length,
      firstMonth: rows[0].ym,
      lastMonth: rows[rows.length - 1].ym,
      lastFullAllFourMonth:
        [...rows].reverse().find((r) => r.cpi !== null && r.m2 !== null && r.gs10 !== null)?.ym ?? null,
      missingMonths,
      sources: SOURCES,
      csvSha256: {
        gold: goldRaw.sha256,
        cpi: cpiRaw.sha256,
        m2: m2Raw.sha256,
        gs10: gs10Raw.sha256,
      },
      caveats: [
        'Monthly spot gold + FRED macro cache used by Gold long-horizon research and the causal Gold/M2 valuation anchor (src/lib/goldLongAnchor.ts).',
        'FRED CPIAUCSL, M2SL, and GS10 are latest-revised series rather than point-in-time ALFRED release vintages.',
        'Consumers must apply at least a 1-month publication lag (macroLagMonths >= 1) before forecasting.',
        'Missing macro observations (e.g., FRED CPIAUCSL 2025-10) are stored as null and resolved causally via backward carry-forward (<= origin - macroLagMonths) during forecasting.',
      ],
    },
    rows,
  };

  writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `[Gold long-horizon] wrote ${rows.length} rows (${payload.metadata.firstMonth} -> ${payload.metadata.lastMonth}, all4 through ${payload.metadata.lastFullAllFourMonth}, missing CPI: ${missingMonths.cpi.join(', ') || 'none'}) to ${OUT_PATH}`
  );
}

main().catch((err) => {
  console.error('[Gold long-horizon] FAILED:', err);
  process.exitCode = 1;
});
