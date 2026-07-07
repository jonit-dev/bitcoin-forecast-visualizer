#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const path = process.argv[2] || join(process.cwd(), 'src/data/stablecoin-history.json');
const cache = JSON.parse(readFileSync(path, 'utf8'));
const rows = cache.rows || [];
if (!Array.isArray(rows) || rows.length < 365) throw new Error(`stablecoin row count too low: ${rows.length}`);
if (cache.metadata?.source !== 'DeFiLlama Stablecoins API') throw new Error('stablecoin source attribution missing');

let previous = '';
for (const row of rows) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`invalid stablecoin date: ${row.date}`);
  if (previous && row.date <= previous) throw new Error(`stablecoin dates not strictly increasing at ${row.date}`);
  previous = row.date;
  if (row.source !== 'DeFiLlama Stablecoins API') throw new Error(`missing row source on ${row.date}`);
  const supply = row.metrics?.totalSupplyUSD;
  if (!Number.isFinite(supply) || supply < 0) throw new Error(`invalid stablecoin supply on ${row.date}`);
  if (!row.availableAfter || new Date(row.availableAfter) <= new Date(`${row.date}T00:00:00Z`)) {
    throw new Error(`stablecoin availableAfter must lag source date on ${row.date}`);
  }
}

const latest = rows.at(-1).date;
const lagDays = Math.round((Date.now() - new Date(`${latest}T00:00:00Z`).getTime()) / 86400000);
if (lagDays > 14) throw new Error(`stablecoin source lag too high: ${lagDays}d`);

console.log(`[Stablecoin validation] OK rows=${rows.length} first=${rows[0].date} latest=${latest} sourceLagDays=${lagDays}`);
