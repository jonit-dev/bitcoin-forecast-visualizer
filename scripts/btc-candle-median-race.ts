// Append weekly origins to the BTC forecast-candle median race, or print its status.
// Usage: npx tsx scripts/btc-candle-median-race.ts [--status] [--dry-run]
// Rules: docs/reports/results/btc-candle-median-race-protocol-v1.md
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { OHLCVData } from '../src/lib/api';
import {
  RACE_VERSION,
  buildRaceForecasts,
  candidateSourceSha256,
  planRaceAppend,
  raceStatus,
  type RaceLedger,
} from '../src/lib/candleMedianRace';

const PROTOCOL = 'docs/reports/results/btc-candle-median-race-protocol-v1.md';
const LEDGER = 'src/data/btc-candle-median-race-ledger.json';
const ohlcv = JSON.parse(readFileSync('src/data/btc-history.json', 'utf8')) as OHLCVData[];
const latestClose = ohlcv[ohlcv.length - 1].date;
const protocolSha256 = createHash('sha256').update(readFileSync(PROTOCOL)).digest('hex');
const sourceSha256 = candidateSourceSha256();

const ledger: RaceLedger = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, 'utf8'))
  : { raceVersion: RACE_VERSION, protocolSha256, candidateSourceSha256: sourceSha256, rows: [] };
if (ledger.protocolSha256 !== protocolSha256) throw new Error(`${PROTOCOL} changed after the freeze. Start a new race version.`);
if (ledger.candidateSourceSha256 !== sourceSha256) throw new Error('Candidate code changed after the freeze. Start a new race version.');

if (!process.argv.includes('--status')) {
  const recordedAt = new Date().toISOString();
  for (const { originDate, kind } of planRaceAppend(ledger, latestClose)) {
    ledger.rows.push(kind === 'prediction'
      ? { kind, originDate, recordedAt, ...buildRaceForecasts(ohlcv, originDate) }
      : { kind, originDate, recordedAt, reason: `missed until ${latestClose}, after origin + 14 days` });
    console.log(`${kind} ${originDate}`);
  }
  if (!process.argv.includes('--dry-run')) writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ latestClose, ...raceStatus(ledger, latestClose) }, null, 2));
