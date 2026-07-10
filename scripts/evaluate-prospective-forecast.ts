import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface FrozenCandidate {
  horizonDays: number;
  candidateId: string;
  configHash: string;
  frozenAt: string;
}

export interface ProspectiveLedgerRow {
  originDate: string;
  targetDate: string;
  horizonDays: number;
  candidateId: string;
  configHash: string;
  recordedAt: string;
  baselineForecast: number;
  candidateForecast: number;
  previousHash: string;
  rowHash: string;
}

export interface ProspectiveLedger {
  protocolVersion: string;
  appendOnly: true;
  protocolSha256: string;
  schemaSha256: string;
  genesisHash: string;
  frozenCandidates: FrozenCandidate[];
  rows: ProspectiveLedgerRow[];
}

export interface ObservedClose { date: string; close: number }

export interface ProspectiveEvaluation {
  status: 'needs more data' | 'ready for final review';
  latestObservedDate: string | null;
  longestHorizonDays: number | null;
  maturedRows: number;
  nominalNonOverlappingOutcomes: number;
  requiredNonOverlappingOutcomes: 30;
  pendingNonOverlappingOutcomes: number;
  scores: Array<{ horizonDays: number; samples: number; baselineMale: number; candidateMale: number }>;
  note: string;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const PROSPECTIVE_SCHEMA_DESCRIPTOR = 'yellow-line-ledger-v1|candidate:horizonDays,candidateId,configHash,frozenAt|row:originDate,targetDate,horizonDays,candidateId,configHash,recordedAt,baselineForecast,candidateForecast,previousHash,rowHash';
export const PROSPECTIVE_SCHEMA_SHA256 = sha256(PROSPECTIVE_SCHEMA_DESCRIPTOR);

function rowPayload(row: ProspectiveLedgerRow): string {
  return JSON.stringify({
    originDate: row.originDate, targetDate: row.targetDate, horizonDays: row.horizonDays,
    candidateId: row.candidateId, configHash: row.configHash, recordedAt: row.recordedAt,
    baselineForecast: row.baselineForecast, candidateForecast: row.candidateForecast,
  });
}

export function prospectiveGenesisHash(protocolVersion: string, protocolSha256: string, schemaSha256 = PROSPECTIVE_SCHEMA_SHA256): string {
  return sha256(`${protocolVersion}\n${protocolSha256}\n${schemaSha256}`);
}

export function prospectiveRowHash(previousHash: string, row: ProspectiveLedgerRow): string {
  return sha256(`${previousHash}\n${rowPayload(row)}`);
}

export function validateLedger(ledger: ProspectiveLedger, expectedProtocolSha256?: string): void {
  if (ledger.appendOnly !== true) throw new Error('prospective ledger must declare appendOnly=true');
  if (ledger.schemaSha256 !== PROSPECTIVE_SCHEMA_SHA256) throw new Error('prospective ledger schema hash mismatch');
  if (expectedProtocolSha256 && ledger.protocolSha256 !== expectedProtocolSha256) throw new Error('prospective protocol content hash mismatch');
  if (ledger.genesisHash !== prospectiveGenesisHash(ledger.protocolVersion, ledger.protocolSha256, ledger.schemaSha256)) throw new Error('prospective genesis hash mismatch');
  const horizons = new Set<number>();
  for (const candidate of ledger.frozenCandidates) {
    if (horizons.has(candidate.horizonDays)) throw new Error(`at most one frozen candidate is allowed for horizon ${candidate.horizonDays}`);
    horizons.add(candidate.horizonDays);
    if (!candidate.candidateId || !candidate.configHash) throw new Error('frozen candidate requires candidateId and configHash');
    if (candidate.candidateId !== 'YL-1' && candidate.candidateId !== 'YL-2') throw new Error('candidateId must be YL-1 or YL-2');
  }
  const identities = new Set<string>();
  let expectedPreviousHash = ledger.genesisHash;
  for (const row of ledger.rows) {
    const identity = `${row.originDate}|${row.horizonDays}|${row.configHash}`;
    if (identities.has(identity)) throw new Error(`duplicate frozen origin/config identity: ${identity}`);
    identities.add(identity);
    const frozen = ledger.frozenCandidates.find(candidate => candidate.horizonDays === row.horizonDays);
    if (!frozen || frozen.candidateId !== row.candidateId || frozen.configHash !== row.configHash) {
      throw new Error(`row does not match frozen candidate at horizon ${row.horizonDays}`);
    }
    if (row.previousHash !== expectedPreviousHash || row.rowHash !== prospectiveRowHash(expectedPreviousHash, row)) throw new Error('prospective row hash-chain integrity failure');
    expectedPreviousHash = row.rowHash;
    if (!(row.baselineForecast > 0) || !(row.candidateForecast > 0)) throw new Error('forecasts must be positive');
    if (dayNumber(row.targetDate) - dayNumber(row.originDate) !== row.horizonDays) throw new Error('targetDate must equal originDate plus horizonDays');
    if (!Number.isFinite(Date.parse(row.recordedAt)) || row.recordedAt.slice(0, 10) > row.originDate) {
      throw new Error('prediction must be recorded no later than its forecast origin');
    }
    if (!Number.isFinite(Date.parse(frozen.frozenAt)) || frozen.frozenAt > row.recordedAt || frozen.frozenAt.slice(0, 10) > row.originDate) {
      throw new Error('candidate must be frozen before every origin and recording timestamp');
    }
  }
}

/** Enforces a literal append: frozen configuration and every prior row must be byte-equivalent. */
export function assertAppendOnly(previous: ProspectiveLedger, next: ProspectiveLedger): void {
  validateLedger(previous);
  validateLedger(next);
  const initialFreeze = previous.rows.length === 0 && previous.frozenCandidates.length === 0 && next.rows.length === 0;
  if (previous.protocolVersion !== next.protocolVersion || previous.protocolSha256 !== next.protocolSha256 || previous.schemaSha256 !== next.schemaSha256 || previous.genesisHash !== next.genesisHash || (!initialFreeze && JSON.stringify(previous.frozenCandidates) !== JSON.stringify(next.frozenCandidates))) {
    throw new Error('frozen prospective configuration cannot be changed');
  }
  if (next.rows.length < previous.rows.length) throw new Error('prospective rows cannot be removed');
  previous.rows.forEach((row, index) => {
    if (JSON.stringify(row) !== JSON.stringify(next.rows[index])) throw new Error(`frozen prospective row ${index} cannot be mutated`);
  });
}

export function maturedLedgerRows(ledger: ProspectiveLedger, latestObservedDate: string): ProspectiveLedgerRow[] {
  validateLedger(ledger);
  return ledger.rows.filter(row => row.targetDate <= latestObservedDate);
}

export function countNominalNonOverlapping(rows: readonly ProspectiveLedgerRow[], horizonDays: number): number {
  const sorted = rows.filter(row => row.horizonDays === horizonDays).sort((a, b) => a.originDate.localeCompare(b.originDate));
  let count = 0;
  let nextAllowedDay = Number.NEGATIVE_INFINITY;
  for (const row of sorted) {
    const originDay = dayNumber(row.originDate);
    if (originDay >= nextAllowedDay) { count++; nextAllowedDay = originDay + horizonDays; }
  }
  return count;
}

export function evaluateProspectiveLedger(ledger: ProspectiveLedger, observed: readonly ObservedClose[]): ProspectiveEvaluation {
  validateLedger(ledger);
  const validObserved = observed.filter(row => row.close > 0 && Number.isFinite(row.close)).sort((a, b) => a.date.localeCompare(b.date));
  const latestObservedDate = validObserved.at(-1)?.date ?? null;
  const longestHorizonDays = ledger.frozenCandidates.length ? Math.max(...ledger.frozenCandidates.map(row => row.horizonDays)) : null;
  const matured = latestObservedDate ? maturedLedgerRows(ledger, latestObservedDate) : [];
  const closeByDate = new Map(validObserved.map(row => [row.date, row.close]));
  const internalScores = ledger.frozenCandidates.map(({ horizonDays }) => {
    const scoreable = matured.filter(row => row.horizonDays === horizonDays && closeByDate.has(row.targetDate));
    const baselineMale = scoreable.length ? scoreable.reduce((sum, row) => sum + Math.abs(Math.log(row.baselineForecast / closeByDate.get(row.targetDate)!)), 0) / scoreable.length : 0;
    const candidateMale = scoreable.length ? scoreable.reduce((sum, row) => sum + Math.abs(Math.log(row.candidateForecast / closeByDate.get(row.targetDate)!)), 0) / scoreable.length : 0;
    return { horizonDays, samples: scoreable.length, baselineMale, candidateMale };
  });
  const scoreable = matured.filter(row => closeByDate.has(row.targetDate));
  const nominal = longestHorizonDays === null ? 0 : countNominalNonOverlapping(scoreable, longestHorizonDays);
  const pending = Math.max(0, 30 - nominal);
  return {
    status: pending === 0 && longestHorizonDays !== null ? 'ready for final review' : 'needs more data',
    latestObservedDate, longestHorizonDays, maturedRows: matured.length, nominalNonOverlappingOutcomes: nominal,
    requiredNonOverlappingOutcomes: 30, pendingNonOverlappingOutcomes: pending, scores: pending === 0 ? internalScores : [],
    note: pending === 0 && longestHorizonDays !== null
      ? 'Stopping rule reached. Apply the frozen final gates; this status does not itself authorize promotion.'
      : 'No interim tuning or promotion is permitted. Continue append-only collection until the stopping rule is reached.',
  };
}

async function main(): Promise<void> {
  const [ledger, observed, protocol] = await Promise.all([
    readFile(new URL('../src/data/prospective-forecast-ledger.json', import.meta.url), 'utf8').then(value => JSON.parse(value) as ProspectiveLedger),
    readFile(new URL('../src/data/btc-history.json', import.meta.url), 'utf8').then(value => JSON.parse(value) as ObservedClose[]),
    readFile(new URL('../docs/reports/results/yellow-line-prospective-protocol.md', import.meta.url), 'utf8'),
  ]);
  validateLedger(ledger, sha256(protocol));
  const result = evaluateProspectiveLedger(ledger, observed);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
