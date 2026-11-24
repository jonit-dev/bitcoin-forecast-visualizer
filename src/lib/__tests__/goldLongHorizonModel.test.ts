import { describe, expect, it } from 'vitest';
import {
  addMonthsYm,
  daysSince1971Aug15,
  predictGoldArm,
  selectGoldDevParams,
  yearsSince1972Jan,
  type GoldLongArmId,
  type GoldMonthlyRow,
} from '../goldLongHorizonModel';

function makeSyntheticMonthlySeries(months = 660, startYm = '1970-01'): GoldMonthlyRow[] {
  const rows: GoldMonthlyRow[] = [];
  for (let i = 0; i < months; i += 1) {
    const ym = addMonthsYm(startYm, i);
    const wave = 0.25 * Math.sin(i / 18) + 0.08 * Math.cos(i / 7);
    const cpi = 38 * Math.exp(0.003 * i);
    const m2 = 600 * Math.exp(0.0055 * i);
    const gold = 35 * Math.exp(0.005 * i + wave);
    const gs10 = 5.0 + 1.5 * Math.sin(i / 24);
    rows.push({ ym, gold, cpi, m2, gs10 });
  }
  return rows;
}

describe('goldLongHorizonModel causality and analytical sanity', () => {
  it('enforces zero future-price and zero same-month macro leakage across all arms', () => {
    const base = makeSyntheticMonthlySeries(600);
    const originIdx = 420; // ~2005-01
    const arms: GoldLongArmId[] = [
      'G0_incumbent',
      'G1_power_law_1971',
      'G2_exponential_mr',
      'G3_erb_harvey_cpi_mr',
      'G4a_m2_ratio_mr',
      'G4b_m2_cpi_coint',
      'G5_real_rate_cpi_drift',
    ];

    // Mutate all rows strictly after originIdx
    const futureMutated = base.map((row, idx) =>
      idx > originIdx
        ? { ...row, gold: row.gold * 9, cpi: row.cpi * 4, m2: (row.m2 ?? 1) * 5, gs10: 15 }
        : row
    );

    // Also mutate macro fields AT originIdx (lag = 1 must ignore macro at originIdx)
    const sameMonthMacroMutated = base.map((row, idx) =>
      idx === originIdx
        ? { ...row, cpi: row.cpi * 10, m2: (row.m2 ?? 1) * 10, gs10: 25 }
        : row
    );

    for (const arm of arms) {
      for (const h of [12, 24, 60, 120]) {
        const pBase = predictGoldArm(arm, base, originIdx, h, { tau: 60, lambda: 0.5, ridge: 25 }, 1);
        const pFuture = predictGoldArm(arm, futureMutated, originIdx, h, { tau: 60, lambda: 0.5, ridge: 25 }, 1);
        const pLag1 = predictGoldArm(arm, sameMonthMacroMutated, originIdx, h, { tau: 60, lambda: 0.5, ridge: 25 }, 1);

        expect(Number.isFinite(pBase)).toBe(true);
        expect(pFuture).toBe(pBase);
        expect(pLag1).toBe(pBase);
      }
    }
  });

  it('never inspects rows with targetYm > 2003-12 during pre-2004 dev selection', () => {
    const base = makeSyntheticMonthlySeries(600);
    const post2003Mutated = base.map((row) =>
      row.ym > '2003-12'
        ? { ...row, gold: row.gold * 12, cpi: row.cpi * 3, m2: (row.m2 ?? 1) * 6, gs10: 19 }
        : row
    );

    const arms: GoldLongArmId[] = [
      'G1_power_law_1971',
      'G2_exponential_mr',
      'G3_erb_harvey_cpi_mr',
      'G4a_m2_ratio_mr',
      'G4b_m2_cpi_coint',
      'G5_real_rate_cpi_drift',
    ];
    for (const arm of arms) {
      const a = selectGoldDevParams(arm, base, 120, 1, '2003-12');
      const b = selectGoldDevParams(arm, post2003Mutated, 120, 1, '2003-12');
      expect(a).toEqual(b);
    }
  });

  it('recovers exact noiseless power-law and exponential growth and reverts stretched CPI/M2 ratios', () => {
    // Noiseless power-law gold since 1971-08-15
    const powerRows: GoldMonthlyRow[] = Array.from({ length: 400 }, (_, i) => {
      const ym = addMonthsYm('1970-01', i);
      const t = daysSince1971Aug15(ym);
      const gold = ym >= '1972-01' ? 0.001 * Math.pow(t, 1.8) : 35;
      return { ym, gold, cpi: 40 * Math.exp(0.003 * i), m2: 600 * Math.exp(0.005 * i), gs10: 5 };
    });
    const plPred = predictGoldArm('G1_power_law_1971', powerRows, 250, 120, { tau: 60 }, 1);
    const plActual = Math.log(powerRows[370].gold / powerRows[250].gold);
    expect(plPred).toBeCloseTo(plActual, 8);

    // Noiseless exponential gold
    const expRows: GoldMonthlyRow[] = Array.from({ length: 400 }, (_, i) => {
      const ym = addMonthsYm('1970-01', i);
      const gold = 100 * Math.exp(0.06 * yearsSince1972Jan(ym));
      return { ym, gold, cpi: 40 * Math.exp(0.003 * i), m2: 600 * Math.exp(0.005 * i), gs10: 5 };
    });
    const expPred = predictGoldArm('G2_exponential_mr', expRows, 250, 120, { tau: 60 }, 1);
    expect(expPred).toBeCloseTo(0.60, 8);

    // Stretched real gold above CPI should predict lower return than equilibrium
    const stretchedRows = makeSyntheticMonthlySeries(450).map((r, i) =>
      i === 400 ? { ...r, gold: r.gold * 3 } : r
    );
    const normalRows = makeSyntheticMonthlySeries(450);
    const stretchedCpi = predictGoldArm('G3_erb_harvey_cpi_mr', stretchedRows, 400, 120, { lambda: 0.75, tau: 60 }, 1);
    const normalCpi = predictGoldArm('G3_erb_harvey_cpi_mr', normalRows, 400, 120, { lambda: 0.75, tau: 60 }, 1);
    expect(stretchedCpi).toBeLessThan(normalCpi);
  });

  it('handles missing monthly CPI via causal backward LOCF without forward leakage', () => {
    const base = makeSyntheticMonthlySeries(500);
    const originIdx = 460;
    const missingCpiRows = base.map((r, idx) =>
      idx === originIdx - 1 ? { ...r, cpi: null } : r
    );
    const forwardMutatedRows = missingCpiRows.map((r, idx) =>
      idx >= originIdx ? { ...r, cpi: (r.cpi ?? 100) * 8 } : r
    );

    const arms: GoldLongArmId[] = [
      'G3_erb_harvey_cpi_mr',
      'G4b_m2_cpi_coint',
      'G5_real_rate_cpi_drift',
    ];
    for (const arm of arms) {
      const predMissing = predictGoldArm(arm, missingCpiRows, originIdx, 120, { tau: 60, lambda: 0.5, ridge: 25 }, 1);
      const predMutated = predictGoldArm(arm, forwardMutatedRows, originIdx, 120, { tau: 60, lambda: 0.5, ridge: 25 }, 1);
      expect(Number.isFinite(predMissing)).toBe(true);
      expect(predMissing).toBe(predMutated);
    }

    // Also verify G5 works when curCpi - 12 months is null (simulating 2026-10 looking back 12m to missing 2025-10)
    const missing12mBack = base.map((r, idx) =>
      idx === originIdx - 13 ? { ...r, cpi: null } : r
    );
    const pred5 = predictGoldArm('G5_real_rate_cpi_drift', missing12mBack, originIdx, 120, { ridge: 25 }, 1);
    expect(Number.isFinite(pred5)).toBe(true);
  });
});
