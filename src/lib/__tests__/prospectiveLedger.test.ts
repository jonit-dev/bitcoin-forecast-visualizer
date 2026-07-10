import { describe, expect, it } from 'vitest';
import {
  assertAppendOnly,
  evaluateProspectiveLedger,
  maturedLedgerRows,
  prospectiveGenesisHash,
  prospectiveRowHash,
  PROSPECTIVE_SCHEMA_SHA256,
  validateLedger,
  type ProspectiveLedger,
} from '../../../scripts/evaluate-prospective-forecast';

const protocolSha256 = 'a'.repeat(64);
const genesisHash = prospectiveGenesisHash('yellow-line-prospective-v1', protocolSha256);
const base: ProspectiveLedger = {
  protocolVersion: 'yellow-line-prospective-v1', appendOnly: true,
  protocolSha256, schemaSha256: PROSPECTIVE_SCHEMA_SHA256, genesisHash,
  frozenCandidates: [{ horizonDays: 30, candidateId: 'YL-2', configHash: 'sha256:test', frozenAt: '2026-07-10T00:00:00Z' }],
  rows: [{
    originDate: '2026-07-10', targetDate: '2026-08-09', horizonDays: 30,
    candidateId: 'YL-2', configHash: 'sha256:test', recordedAt: '2026-07-10T00:01:00Z',
    baselineForecast: 100, candidateForecast: 105,
    previousHash: genesisHash, rowHash: '',
  }],
};
base.rows[0].rowHash = prospectiveRowHash(genesisHash, base.rows[0]);

describe('prospective forecast ledger', () => {
  it('should reject mutation of a frozen origin and config hash', () => {
    const mutated = structuredClone(base);
    mutated.rows[0].candidateForecast = 106;
    expect(() => assertAppendOnly(base, mutated)).toThrow(/hash-chain integrity/);

    const appended = structuredClone(base);
    const appendedRow = { ...base.rows[0], originDate: '2026-08-09', targetDate: '2026-09-08', recordedAt: '2026-08-09T00:01:00Z', previousHash: base.rows[0].rowHash, rowHash: '' };
    appendedRow.rowHash = prospectiveRowHash(appendedRow.previousHash, appendedRow);
    appended.rows.push(appendedRow);
    expect(() => assertAppendOnly(base, appended)).not.toThrow();
  });

  it('should score only matured targets', () => {
    expect(maturedLedgerRows(base, '2026-08-08')).toEqual([]);
    expect(maturedLedgerRows(base, '2026-08-09')).toEqual(base.rows);
    const pending = evaluateProspectiveLedger(base, [{ date: '2026-08-08', close: 110 }]);
    expect(pending.maturedRows).toBe(0);
    expect(pending.scores).toEqual([]);
    expect(pending.status).toBe('needs more data');
  });

  it('enforces at most one frozen candidate per horizon', () => {
    const invalid = structuredClone(base);
    invalid.frozenCandidates.push({ ...invalid.frozenCandidates[0], candidateId: 'YL-1', configHash: 'sha256:other' });
    expect(() => validateLedger(invalid)).toThrow(/at most one frozen candidate/);
  });

  it('allows one pre-origin freeze and then prevents candidate changes', () => {
    const empty: ProspectiveLedger = { protocolVersion: base.protocolVersion, appendOnly: true, protocolSha256, schemaSha256: PROSPECTIVE_SCHEMA_SHA256, genesisHash, frozenCandidates: [], rows: [] };
    const selected: ProspectiveLedger = { ...empty, frozenCandidates: base.frozenCandidates };
    expect(() => assertAppendOnly(empty, selected)).not.toThrow();
    const changed = structuredClone(selected);
    changed.frozenCandidates[0].configHash = 'sha256:changed';
    expect(() => assertAppendOnly(selected, changed)).toThrow(/configuration cannot be changed/);
  });

  it('rejects hash-chain tampering and invalid chronology', () => {
    const tampered = structuredClone(base);
    tampered.rows[0].baselineForecast = 99;
    expect(() => validateLedger(tampered)).toThrow(/hash-chain integrity/);
    const lateFreeze = structuredClone(base);
    lateFreeze.frozenCandidates[0].frozenAt = '2026-07-11T00:00:00Z';
    expect(() => validateLedger(lateFreeze)).toThrow(/frozen before/);
    const lateRecord = structuredClone(base);
    lateRecord.rows[0].recordedAt = '2026-07-11T00:00:00Z';
    lateRecord.rows[0].rowHash = prospectiveRowHash(lateRecord.rows[0].previousHash, lateRecord.rows[0]);
    expect(() => validateLedger(lateRecord)).toThrow(/no later than/);
  });

  it('rejects candidate families outside YL-1 and YL-2', () => {
    const invalid = structuredClone(base);
    invalid.frozenCandidates[0].candidateId = 'YL-2P';
    invalid.rows[0].candidateId = 'YL-2P';
    invalid.rows[0].rowHash = prospectiveRowHash(invalid.rows[0].previousHash, invalid.rows[0]);
    expect(() => validateLedger(invalid)).toThrow(/must be YL-1 or YL-2/);
  });

  it('does not count rows without an actual target close or reveal interim scores', () => {
    const result = evaluateProspectiveLedger(base, [{ date: '2026-08-10', close: 110 }]);
    expect(result.maturedRows).toBe(1);
    expect(result.nominalNonOverlappingOutcomes).toBe(0);
    expect(result.scores).toEqual([]);
  });

  it('requires 30 nominal non-overlapping outcomes at the longest horizon', () => {
    const ledger = structuredClone(base);
    ledger.frozenCandidates[0].frozenAt = '2019-12-31T00:00:00Z';
    let previousHash = ledger.genesisHash;
    ledger.rows = Array.from({ length: 30 }, (_, index) => {
      const origin = new Date(Date.UTC(2020, 0, 1 + index * 30));
      const target = new Date(origin.getTime() + 30 * 86_400_000);
      const row = { ...base.rows[0], originDate: origin.toISOString().slice(0, 10), targetDate: target.toISOString().slice(0, 10), recordedAt: origin.toISOString(), previousHash, rowHash: '' };
      row.rowHash = prospectiveRowHash(previousHash, row);
      previousHash = row.rowHash;
      return row;
    });
    const lastTarget = ledger.rows.at(-1)!.targetDate;
    const observed = ledger.rows.map(row => ({ date: row.targetDate, close: 110 }));
    const result = evaluateProspectiveLedger(ledger, [...observed, { date: lastTarget, close: 110 }]);
    expect(result.nominalNonOverlappingOutcomes).toBe(30);
    expect(result.status).toBe('ready for final review');
    expect(result.note).toContain('does not itself authorize promotion');
  });
});
