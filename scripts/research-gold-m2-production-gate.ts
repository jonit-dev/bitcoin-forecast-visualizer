import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OHLCVData } from '../src/lib/api';
import { computeGoldM2MeanReversion, GOLD_M2_ANCHOR_CONFIG } from '../src/lib/goldLongAnchor';
import {
  circularBlockBootstrapMeanDiff,
  GOLD_ANCHOR_START_YM,
  GOLD_DEV_START_YM,
  GOLD_HOLDOUT_START_YM,
  neweyWestDmT,
  predictG0Incumbent,
  type GoldMonthlyRow,
} from '../src/lib/goldLongHorizonModel';
import {
  buildGenericModelInputs,
  computeGenericProbabilityForecast,
  genericLogScaleAtDay,
  genericMedianLogReturnAtDay,
} from '../src/lib/marketForecast';

const MONTHLY_PATH = join(process.cwd(), 'src', 'data', 'gold-long-horizon-monthly.json');
const GLD_PATH = join(process.cwd(), 'src', 'data', 'gld-history.json');
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const REPORT_DATE = '2026-11-24';

const DEV_END_YM = '2003-12';
const DEV_HORIZONS = [24, 60, 120] as const;
const LAMBDA_GRID = [0.25, 0.5, 0.75, 1.0] as const;
const TAU_GRID = [24, 36, 48, 60, 84, 120] as const;
const GLD_HORIZONS = [730, 1825, 3650] as const;
const GLD_STEP_SESSIONS = 10;
const GLD_MIN_INDEX = 1000;
const QUANTILES = [0.05, 0.1, 0.5, 0.9, 0.95] as const;
const BOOTSTRAP_REPS = 5000;
const BOOTSTRAP_SEED = 20261124;

function mean(xs: readonly number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function safeGitHead(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function causalGoldM2GapAtIndex(rows: readonly GoldMonthlyRow[], i: number, macroLagMonths: number): number {
  const start = Math.max(
    macroLagMonths,
    rows.findIndex((r) => r.ym >= GOLD_ANCHOR_START_YM)
  );
  let sumV = 0;
  let cnt = 0;
  for (let s = start; s <= i; s += 1) {
    const m2 = rows[s - macroLagMonths]?.m2;
    if (rows[s].gold > 0 && m2 !== null && m2 > 0) {
      sumV += Math.log(rows[s].gold) - Math.log(m2);
      cnt += 1;
    }
  }
  let curIdx = i - macroLagMonths;
  while (curIdx >= Math.max(0, i - macroLagMonths - 2) && !(rows[curIdx]?.m2 && rows[curIdx]!.m2! > 0)) {
    curIdx -= 1;
  }
  const curM2 = curIdx >= 0 ? rows[curIdx].m2 : null;
  if (cnt < GOLD_M2_ANCHOR_CONFIG.minExpandingObs || curM2 === null || !(curM2 > 0)) {
    return Number.NaN;
  }
  return Math.log(rows[i].gold) - Math.log(curM2) - sumV / cnt;
}

function predictMonthlyUnifiedAnchor(
  rows: readonly GoldMonthlyRow[],
  i: number,
  horizonMonths: number,
  lambda: number,
  tauMonths: number,
  macroLagMonths = 1
): number {
  const y0 = predictG0Incumbent(rows, i, horizonMonths);
  if (horizonMonths <= 12) return y0;
  const gap = causalGoldM2GapAtIndex(rows, i, macroLagMonths);
  if (!Number.isFinite(gap)) return y0;
  const dtMonths = horizonMonths - 12;
  return y0 - lambda * gap * (1 - Math.exp(-dtMonths / tauMonths));
}

function main(): void {
  const monthlyRaw = readFileSync(MONTHLY_PATH, 'utf8');
  const monthlySha = createHash('sha256').update(monthlyRaw).digest('hex');
  const monthlyRows = (JSON.parse(monthlyRaw) as { rows: GoldMonthlyRow[] }).rows;

  const gldRaw = readFileSync(GLD_PATH, 'utf8');
  const gldSha = createHash('sha256').update(gldRaw).digest('hex');
  const gldRows = JSON.parse(gldRaw) as OHLCVData[];

  // 1. Pre-2004 pooled dev selection
  const g0DevMale: Record<number, number> = {};
  for (const h of DEV_HORIZONS) {
    const errs: number[] = [];
    for (let i = 24; i + h < monthlyRows.length; i += 1) {
      if (monthlyRows[i].ym >= GOLD_DEV_START_YM && monthlyRows[i + h].ym <= DEV_END_YM) {
        const actual = Math.log(monthlyRows[i + h].gold / monthlyRows[i].gold);
        errs.push(Math.abs(actual - predictG0Incumbent(monthlyRows, i, h)));
      }
    }
    g0DevMale[h] = mean(errs);
  }

  interface GridEntry {
    lambda: number;
    tauMonths: number;
    devRatio: number;
    devMaleByH: Record<number, number>;
    holdMaleByH: Record<number, number>;
  }
  const grid: GridEntry[] = [];
  for (const lambda of LAMBDA_GRID) {
    for (const tauMonths of TAU_GRID) {
      let devRatio = 0;
      const devMaleByH: Record<number, number> = {};
      const holdMaleByH: Record<number, number> = {};
      for (const h of DEV_HORIZONS) {
        const devErrs: number[] = [];
        const holdErrs: number[] = [];
        for (let i = 24; i + h < monthlyRows.length; i += 1) {
          const actual = Math.log(monthlyRows[i + h].gold / monthlyRows[i].gold);
          const pred = predictMonthlyUnifiedAnchor(monthlyRows, i, h, lambda, tauMonths, 1);
          const err = Math.abs(actual - pred);
          if (monthlyRows[i].ym >= GOLD_DEV_START_YM && monthlyRows[i + h].ym <= DEV_END_YM) {
            devErrs.push(err);
          }
          if (monthlyRows[i].ym >= GOLD_HOLDOUT_START_YM) {
            holdErrs.push(err);
          }
        }
        devMaleByH[h] = mean(devErrs);
        holdMaleByH[h] = mean(holdErrs);
        devRatio += devMaleByH[h] / g0DevMale[h];
      }
      devRatio /= DEV_HORIZONS.length;
      grid.push({ lambda, tauMonths, devRatio, devMaleByH, holdMaleByH });
    }
  }
  grid.sort((a, b) => a.devRatio - b.devRatio);
  const winner = grid[0];

  // 2. Post-2004 monthly holdout + lag=2 sensitivity for selected params
  const monthlyHoldout = DEV_HORIZONS.map((h) => {
    const diffsLag1: number[] = [];
    const diffsLag2: number[] = [];
    const e0Arr: number[] = [];
    const e1Arr: number[] = [];
    const e2Arr: number[] = [];
    for (let i = 24; i + h < monthlyRows.length; i += 1) {
      if (monthlyRows[i].ym < GOLD_HOLDOUT_START_YM) continue;
      const actual = Math.log(monthlyRows[i + h].gold / monthlyRows[i].gold);
      const e0 = Math.abs(actual - predictG0Incumbent(monthlyRows, i, h));
      const e1 = Math.abs(actual - predictMonthlyUnifiedAnchor(monthlyRows, i, h, winner.lambda, winner.tauMonths, 1));
      const e2 = Math.abs(actual - predictMonthlyUnifiedAnchor(monthlyRows, i, h, winner.lambda, winner.tauMonths, 2));
      e0Arr.push(e0);
      e1Arr.push(e1);
      e2Arr.push(e2);
      diffsLag1.push(e0 - e1);
      diffsLag2.push(e0 - e2);
    }
    const boot1 = circularBlockBootstrapMeanDiff(diffsLag1, h, BOOTSTRAP_REPS, BOOTSTRAP_SEED);
    const boot2 = circularBlockBootstrapMeanDiff(diffsLag2, h, BOOTSTRAP_REPS, BOOTSTRAP_SEED);
    const nw1 = neweyWestDmT(diffsLag1, Math.max(1, h - 1));
    const nw2 = neweyWestDmT(diffsLag2, Math.max(1, h - 1));
    return {
      horizonMonths: h,
      n: diffsLag1.length,
      maleG0: mean(e0Arr),
      maleChallengerLag1: mean(e1Arr),
      maleChallengerLag2: mean(e2Arr),
      deltaLag1: -boot1.observedMean,
      bootCi95LowLag1: -boot1.upper95,
      bootCi95HighLag1: -boot1.lower95,
      bootPLag1: boot1.pOneSided,
      nwTLag1: nw1.tStat,
      deltaLag2: -boot2.observedMean,
      bootCi95LowLag2: -boot2.upper95,
      bootCi95HighLag2: -boot2.lower95,
      bootPLag2: boot2.pOneSided,
      nwTLag2: nw2.tStat,
    };
  });

  // 3. Six-period consistency check (1975-2026) at 60m and 120m
  const subPeriodsSpecs = [
    ['1975-01', '1984-12'],
    ['1985-01', '1994-12'],
    ['1995-01', '2003-12'],
    ['2004-01', '2009-12'],
    ['2010-01', '2015-12'],
    ['2016-01', '2026-10'],
  ] as const;
  const subPeriods = ([60, 120] as const).map((h) => ({
    horizonMonths: h,
    rows: subPeriodsSpecs
      .map(([startYm, endYm]) => {
        const e0s: number[] = [];
        const e1s: number[] = [];
        for (let i = 24; i + h < monthlyRows.length; i += 1) {
          if (monthlyRows[i].ym < startYm || monthlyRows[i].ym > endYm) continue;
          const actual = Math.log(monthlyRows[i + h].gold / monthlyRows[i].gold);
          e0s.push(Math.abs(actual - predictG0Incumbent(monthlyRows, i, h)));
          e1s.push(Math.abs(actual - predictMonthlyUnifiedAnchor(monthlyRows, i, h, winner.lambda, winner.tauMonths, 1)));
        }
        return {
          period: `${startYm}..${endYm}`,
          n: e0s.length,
          maleG0: mean(e0s),
          maleChallenger: mean(e1s),
          delta: mean(e1s) - mean(e0s),
        };
      })
      .filter((r) => r.n > 0),
  }));

  // 4. Daily GLD production walk-forward comparison at 730d, 1825d, 3650d
  const gldWalkForward = GLD_HORIZONS.map((h) => {
    const lastDate = gldRows[gldRows.length - 1].date;
    let target = GLD_MIN_INDEX;
    const mae0: number[] = [];
    const mae1: number[] = [];
    const pb0: number[] = [];
    const pb1: number[] = [];
    const c80_0: number[] = [];
    const c80_1: number[] = [];
    const c90_0: number[] = [];
    const c90_1: number[] = [];
    const br0: number[] = [];
    const br1: number[] = [];
    const bias0: number[] = [];
    const bias1: number[] = [];

    for (let i = GLD_MIN_INDEX; i < gldRows.length; i += GLD_STEP_SESSIONS) {
      const originDate = gldRows[i].date;
      const targetDate = addDays(originDate, h);
      if (targetDate > lastDate) break;
      target = Math.max(target, i);
      while (target + 1 < gldRows.length && gldRows[target + 1].date <= targetDate) {
        target += 1;
      }
      if (target <= i) continue;

      const hist = gldRows.slice(0, i + 1);
      const { modelInputs, calibrationLabel } = buildGenericModelInputs('gold', hist, h);
      // Compare pure incumbent baseline (no Gold/M2 MR) vs candidate Gold/M2 MR on identical history
      const baseInputs = { ...modelInputs, longRunMeanReversion: undefined };
      const mr = computeGoldM2MeanReversion(hist, monthlyRows);
      const candInputs = {
        ...modelInputs,
        longRunMeanReversion: mr ? { amplitude: mr.amplitude, decayDays: mr.decayDays } : undefined,
      };
      const f0 = computeGenericProbabilityForecast(hist, h, baseInputs, calibrationLabel);
      const f1 = computeGenericProbabilityForecast(hist, h, candInputs, calibrationLabel);
      if (!f0 || !f1) continue;

      const spot = gldRows[i].close;
      const y = Math.log(gldRows[target].close / spot);
      const q0 = [f0.q05, f0.q10, f0.median, f0.q90, f0.q95].map((p) => Math.log(p / spot));
      const q1 = [f1.q05, f1.q10, f1.median, f1.q90, f1.q95].map((p) => Math.log(p / spot));

      const pin0 = QUANTILES.reduce((s, p, k) => s + Math.max(p * (y - q0[k]), (p - 1) * (y - q0[k])), 0) / QUANTILES.length;
      const pin1 = QUANTILES.reduce((s, p, k) => s + Math.max(p * (y - q1[k]), (p - 1) * (y - q1[k])), 0) / QUANTILES.length;

      const sigma = Math.max(1e-9, genericLogScaleAtDay(candInputs, h));
      const med1Log = genericMedianLogReturnAtDay(candInputs, h);
      const pUp1 = Math.min(0.99, Math.max(0.01, normalCdf(med1Log / sigma)));

      mae0.push(Math.abs(y - q0[2]));
      mae1.push(Math.abs(y - q1[2]));
      bias0.push(q0[2] - y);
      bias1.push(q1[2] - y);
      pb0.push(pin0);
      pb1.push(pin1);
      c80_0.push(y >= q0[1] && y <= q0[3] ? 1 : 0);
      c80_1.push(y >= q1[1] && y <= q1[3] ? 1 : 0);
      c90_0.push(y >= q0[0] && y <= q0[4] ? 1 : 0);
      c90_1.push(y >= q1[0] && y <= q1[4] ? 1 : 0);
      const up = y > 0 ? 1 : 0;
      br0.push((f0.probabilityUp - up) ** 2);
      br1.push((pUp1 - up) ** 2);
    }

    const pinballDiffs = pb0.map((v, idx) => v - pb1[idx]);
    const nwLag = Math.ceil(((h * 252) / 365) / GLD_STEP_SESSIONS) + 1;
    const nwPinball = neweyWestDmT(pinballDiffs, nwLag);
    const meanMae0 = mean(mae0);
    const meanMae1 = mean(mae1);
    const meanPb0 = mean(pb0);
    const meanPb1 = mean(pb1);
    return {
      horizonDays: h,
      n: mae0.length,
      maeG0: meanMae0,
      maeChallenger: meanMae1,
      maeGainPct: (1 - meanMae1 / meanMae0) * 100,
      biasG0: mean(bias0),
      biasChallenger: mean(bias1),
      pinballG0: meanPb0,
      pinballChallenger: meanPb1,
      pinballGainPct: (1 - meanPb1 / meanPb0) * 100,
      pinballNwT: nwPinball.tStat,
      cov80G0: mean(c80_0),
      cov80Challenger: mean(c80_1),
      cov90G0: mean(c90_0),
      cov90Challenger: mean(c90_1),
      brierG0: mean(br0),
      brierChallenger: mean(br1),
    };
  });

  // 5. Evaluate promotion gate criteria
  const gateFailures: string[] = [];
  if (winner.lambda !== GOLD_M2_ANCHOR_CONFIG.lambda || winner.tauMonths !== GOLD_M2_ANCHOR_CONFIG.tauMonths) {
    gateFailures.push(
      `Pre-2004 dev selected (lambda=${winner.lambda}, tau=${winner.tauMonths}) != runtime config (${GOLD_M2_ANCHOR_CONFIG.lambda}, ${GOLD_M2_ANCHOR_CONFIG.tauMonths})`
    );
  }
  if (!(winner.devRatio <= 1.005)) {
    gateFailures.push(`Pre-2004 devRatio ${winner.devRatio.toFixed(4)} > 1.005`);
  }
  for (const row of monthlyHoldout) {
    if (!(row.deltaLag1 < 0 && row.bootCi95HighLag1 < 0 && row.bootPLag1 < 0.01 && row.nwTLag1 > 2.5)) {
      gateFailures.push(`Monthly lag=1 failed at ${row.horizonMonths}m`);
    }
    if (!(row.deltaLag2 < 0 && row.bootCi95HighLag2 < 0 && row.bootPLag2 < 0.01 && row.nwTLag2 > 2.5)) {
      gateFailures.push(`Monthly lag=2 failed at ${row.horizonMonths}m`);
    }
  }
  for (const row of gldWalkForward) {
    if (!(row.maeGainPct > 0 && row.pinballGainPct > 0)) {
      gateFailures.push(`Daily GLD walk-forward did not improve MAE & Pinball at ${row.horizonDays}d`);
    }
    if (row.brierChallenger > row.brierG0 + 1e-6) {
      gateFailures.push(`Daily GLD Brier degraded at ${row.horizonDays}d`);
    }
    const cov90Miss0 = Math.abs(row.cov90G0 - 0.9);
    const cov90Miss1 = Math.abs(row.cov90Challenger - 0.9);
    if (cov90Miss1 > cov90Miss0 + 0.015) {
      gateFailures.push(`Daily GLD cov90 drifted by >1.5pp away from 90% at ${row.horizonDays}d`);
    }
  }

  const passed = gateFailures.length === 0;
  const liveMr = computeGoldM2MeanReversion(gldRows, monthlyRows);
  const gitCommit = safeGitHead();

  const jsonPayload = {
    reportDate: REPORT_DATE,
    gitCommit,
    config: GOLD_M2_ANCHOR_CONFIG,
    datasets: {
      monthly: { path: 'src/data/gold-long-horizon-monthly.json', sha256: monthlySha, rows: monthlyRows.length },
      gld: { path: 'src/data/gld-history.json', sha256: gldSha, rows: gldRows.length, lastDate: gldRows[gldRows.length - 1].date },
    },
    g0DevMale,
    devGridTop8: grid.slice(0, 8),
    monthlyHoldout,
    subPeriods,
    gldWalkForward,
    liveGldAnchor: liveMr
      ? {
          originDate: gldRows[gldRows.length - 1].date,
          originGldClose: gldRows[gldRows.length - 1].close,
          ...liveMr,
        }
      : null,
    gate: {
      passed,
      failures: gateFailures,
    },
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = join(REPORT_DIR, `gold-m2-production-gate-${REPORT_DATE}.json`);
  const mdPath = join(REPORT_DIR, `gold-m2-production-gate-${REPORT_DATE}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, 'utf8');

  const md: string[] = [];
  md.push(`# Gold Long-Horizon \`Gold/M2\` Anchor Production Gate (${REPORT_DATE})`);
  md.push('');
  md.push(`- **Gate Verdict:** **${passed ? 'PASS' : 'FAIL'}**${gateFailures.length > 0 ? ` (${gateFailures.join('; ')})` : ''}`);
  md.push(`- **Frozen Specification:** For \`day <= 365\`, production Gold forecast is unchanged (\`momentum\` / \`gold365V2\`). For \`day > 365\`, log median return adds \`-0.25 * gap * (1 - exp(-(day - 365) / 3652.5))\` on top of the \`+4%/yr\` long-run drift, where \`gap = ln(spotGoldNow / M2_lagged) - expandingMean(ln(Gold / M2_lag1))\`.`);
  md.push(`- **Pre-2004 Dev Selection (pooled over 24m/60m/120m):** \`lambda=${winner.lambda}, tau=${winner.tauMonths}m\` ranked #1 (` +
    `devRatio \`${winner.devRatio.toFixed(4)}\` vs \`G0\`).`);
  md.push(`- **Live GLD Snapshot (\`${gldRows[gldRows.length - 1].date}\`, GLD \`$${gldRows[gldRows.length - 1].close.toFixed(2)}\`):** ${liveMr ? `\`M2=${liveMr.m2Month}\`, \`gap=${liveMr.gap.toFixed(4)}\` (\`${liveMr.ratioToMean.toFixed(2)}x\` vs expanding historical mean), \`amplitude=${liveMr.amplitude.toFixed(4)}\`.` : '`null`'}`);
  md.push('');
  md.push('## Monthly 2004-2026 Out-of-Sample Holdout (Lag = 1m and Lag = 2m Sensitivity)');
  md.push('');
  md.push('| Horizon | n | G0 MALE | Anchor MALE (lag=1) | delta (lag=1) | 95% Boot CI (lag=1) | Boot p (1s) | NW DM t | Lag=2 delta | Lag=2 Boot p | Lag=2 NW t |');
  md.push('|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|');
  for (const r of monthlyHoldout) {
    md.push(
      `| ${r.horizonMonths}m (${r.horizonMonths / 12}Y) | ${r.n} | ${r.maleG0.toFixed(4)} | ${r.maleChallengerLag1.toFixed(4)} | ${r.deltaLag1.toFixed(4)} | [${r.bootCi95LowLag1.toFixed(4)}, ${r.bootCi95HighLag1.toFixed(4)}] | ${r.bootPLag1.toFixed(4)} | +${r.nwTLag1.toFixed(2)} | ${r.deltaLag2.toFixed(4)} | ${r.bootPLag2.toFixed(4)} | +${r.nwTLag2.toFixed(2)} |`
    );
  }
  md.push('');
  md.push('## Daily GLD Walk-Forward Gate (2009-2026 Origins, Step 10 Sessions)');
  md.push('');
  md.push('| Horizon | n | G0 MAE | Anchor MAE | MAE Gain | G0 Pinball | Anchor Pinball | Pinball Gain | NW Pinball t | Cov90 | Cov80 | Brier |');
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|');
  for (const r of gldWalkForward) {
    md.push(
      `| ${r.horizonDays}d (${(r.horizonDays / 365).toFixed(0)}Y) | ${r.n} | ${r.maeG0.toFixed(4)} | ${r.maeChallenger.toFixed(4)} | +${r.maeGainPct.toFixed(1)}% | ${r.pinballG0.toFixed(5)} | ${r.pinballChallenger.toFixed(5)} | +${r.pinballGainPct.toFixed(1)}% | +${r.pinballNwT.toFixed(2)} | ${(r.cov90G0 * 100).toFixed(1)}% -> ${(r.cov90Challenger * 100).toFixed(1)}% | ${(r.cov80G0 * 100).toFixed(1)}% -> ${(r.cov80Challenger * 100).toFixed(1)}% | ${r.brierG0.toFixed(3)} -> ${r.brierChallenger.toFixed(3)} |`
    );
  }
  md.push('');
  md.push('## Monthly 1975-2026 Sub-Period Breakdown');
  md.push('');
  for (const sp of subPeriods) {
    md.push(`### ${sp.horizonMonths}m (${sp.horizonMonths / 12}Y)`);
    md.push('');
    md.push('| Origin Period | n | G0 MALE | Anchor MALE | deltaMALE |');
    md.push('|---|---:|---:|---:|---:|');
    for (const r of sp.rows) {
      md.push(`| ${r.period} | ${r.n} | ${r.maleG0.toFixed(4)} | ${r.maleChallenger.toFixed(4)} | ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(4)} |`);
    }
    md.push('');
  }

  writeFileSync(mdPath, `${md.join('\n')}\n`, 'utf8');
  console.log(`[Gold M2 Gate] wrote ${mdPath}`);
  console.log(`[Gold M2 Gate] GATE: ${passed ? 'PASS' : `FAIL (${gateFailures.join('; ')})`}`);
  if (!passed) process.exitCode = 1;
}

main();
