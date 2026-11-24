import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addMonthsYm,
  circularBlockBootstrapMeanDiff,
  GOLD_ANCHOR_START_YM,
  GOLD_DEV_START_YM,
  GOLD_HOLDOUT_START_YM,
  GOLD_HORIZONS_MONTHS,
  holmAdjust,
  neweyWestDmT,
  predictGoldArm,
  selectGoldDevParams,
  type GoldArmParams,
  type GoldLongArmId,
  type GoldMonthlyRow,
} from '../src/lib/goldLongHorizonModel';

const DATA_PATH = join(process.cwd(), 'src', 'data', 'gold-long-horizon-monthly.json');
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const REPORT_DATE = '2026-11-24';
const DEV_END_YM = '2003-12';
const BOOTSTRAP_REPS = 5000;
const BOOTSTRAP_SEED = 20261124;

const ALL_ARMS: GoldLongArmId[] = [
  'G0_incumbent',
  'G1_power_law_1971',
  'G2_exponential_mr',
  'G3_erb_harvey_cpi_mr',
  'G4a_m2_ratio_mr',
  'G4b_m2_cpi_coint',
  'G5_real_rate_cpi_drift',
];

const CHALLENGER_ARMS: GoldLongArmId[] = ALL_ARMS.filter((arm) => arm !== 'G0_incumbent');
const MACRO_ARMS: GoldLongArmId[] = [
  'G3_erb_harvey_cpi_mr',
  'G4a_m2_ratio_mr',
  'G4b_m2_cpi_coint',
  'G5_real_rate_cpi_drift',
];

const ARM_DESCRIPTIONS: Record<GoldLongArmId, string> = {
  G0_incumbent: 'Current production gold rule (1Y capped momentum -> +4%/yr long drift)',
  G1_power_law_1971: 'Causal log-log power law anchored at 1971-08-15 (+ dev-selected mean reversion)',
  G2_exponential_mr: 'Causal log-linear exponential trend since 1972-01 (+ dev-selected MR)',
  G3_erb_harvey_cpi_mr: 'Erb & Harvey causal Gold/CPI real-price mean reversion + CPI drift',
  G4a_m2_ratio_mr: 'Causal Gold/M2 ratio mean reversion + causal M2 growth drift',
  G4b_m2_cpi_coint: 'Causal 2-factor M2 + CPI cointegration ridge regression + residual MR',
  G5_real_rate_cpi_drift: '1Y momentum then causal 5Y CPI + real-10Y rate (GS10 - YoY CPI) ridge drift',
};

interface HoldoutObservation {
  originIdx: number;
  originYm: string;
  targetYm: string;
  actual: number;
  preds: Record<GoldLongArmId, number>;
}

interface HoldoutArmResult {
  armId: GoldLongArmId;
  horizonMonths: number;
  selectedParams: GoldArmParams;
  devMale: number;
  nDev: number;
  n: number;
  male: number;
  rmsle: number;
  bias: number;
  hitRate: number;
  deltaMaleVsG0: number;
  deltaBootCi95Low: number | null;
  deltaBootCi95High: number | null;
  bootPOneSided: number | null;
  holmBootP: number | null;
  nwDmT: number | null;
  nwPOneSided: number | null;
  holmNwP: number | null;
}

interface SubPeriodCell {
  label: string;
  originStartYm: string;
  originEndYm: string;
  n: number;
  maleByArm: Record<GoldLongArmId, number>;
  deltaVsG0ByArm: Record<GoldLongArmId, number>;
}

interface LagSensitivityRow {
  armId: GoldLongArmId;
  horizonMonths: number;
  n: number;
  maleLag1: number;
  maleLag2: number;
  deltaMaleVsG0Lag1: number;
  deltaMaleVsG0Lag2: number;
  deltaBootCi95LowLag2: number;
  deltaBootCi95HighLag2: number;
  bootPOneSidedLag2: number;
  holmBootPLag2: number;
  preservesNegativeSign: boolean;
}

interface LiveProjectionRow {
  horizonMonths: number;
  targetYm: string;
  armId: GoldLongArmId;
  selectedParams: GoldArmParams;
  predLogReturn: number;
  impliedPriceUsd: number;
  annualizedCagrPct: number;
  pctChangeFromSpot: number;
}

interface GateEvaluation {
  armId: GoldLongArmId;
  delta120m: number;
  bootCi95High120m: number | null;
  holmBootP120m: number | null;
  delta60m: number;
  delta120mLag2: number | null;
  holmBootPLag2_120m: number | null;
  passes120mDelta: boolean;
  passes120mCi: boolean;
  passes120mHolm: boolean;
  passes60mGuard: boolean;
  passesLag2Sensitivity: boolean;
  passesPreRegisteredGate: boolean;
}

function mean(xs: readonly number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
}

function fmt(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'n/a';
  return x.toFixed(digits);
}

function fmtSigned(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'n/a';
  return `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;
}

function fmtPct(x: number, digits = 2): string {
  return Number.isFinite(x) ? `${x.toFixed(digits)}%` : 'n/a';
}

function fmtUsd(x: number): string {
  return Number.isFinite(x) ? `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'n/a';
}

function fmtParams(params: GoldArmParams): string {
  const parts: string[] = [];
  if (params.lambda !== undefined) parts.push(`lambda=${params.lambda}`);
  if (params.tau !== undefined) parts.push(`tau=${Number.isFinite(params.tau) ? params.tau : 'inf'}`);
  if (params.ridge !== undefined) parts.push(`ridge=${params.ridge}`);
  return parts.length > 0 ? parts.join(', ') : '-';
}

function safeGitHead(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function collectHoldoutObservations(
  rows: readonly GoldMonthlyRow[],
  horizonMonths: number,
  selectedParamsByArm: Record<GoldLongArmId, GoldArmParams>,
  macroLagMonths: number
): HoldoutObservation[] {
  const obs: HoldoutObservation[] = [];
  for (let i = 0; i + horizonMonths < rows.length; i += 1) {
    if (rows[i].ym < GOLD_HOLDOUT_START_YM) continue;
    const actual = Math.log(rows[i + horizonMonths].gold / rows[i].gold);
    if (!Number.isFinite(actual)) {
      throw new Error(`Non-finite actual return at origin=${rows[i].ym}, h=${horizonMonths}`);
    }
    const preds = {} as Record<GoldLongArmId, number>;
    for (const armId of ALL_ARMS) {
      const pred = predictGoldArm(armId, rows, i, horizonMonths, selectedParamsByArm[armId], macroLagMonths);
      if (!Number.isFinite(pred)) {
        throw new Error(`Non-finite prediction for ${armId} at origin=${rows[i].ym}, h=${horizonMonths}, lag=${macroLagMonths}`);
      }
      preds[armId] = pred;
    }
    obs.push({
      originIdx: i,
      originYm: rows[i].ym,
      targetYm: rows[i + horizonMonths].ym,
      actual,
      preds,
    });
  }
  return obs;
}

function evaluateHoldoutSlice(
  obs: readonly HoldoutObservation[],
  horizonMonths: number,
  devMeta: Record<GoldLongArmId, { params: GoldArmParams; devMale: number; nDev: number }>
): HoldoutArmResult[] {
  const absErrorsByArm = {} as Record<GoldLongArmId, number[]>;
  const resultsByArm = {} as Record<GoldLongArmId, HoldoutArmResult>;

  for (const armId of ALL_ARMS) {
    const errs: number[] = [];
    const absErrs: number[] = [];
    const sqErrs: number[] = [];
    let hits = 0;
    for (const o of obs) {
      const pred = o.preds[armId];
      const err = pred - o.actual;
      const absErr = Math.abs(o.actual - pred);
      errs.push(err);
      absErrs.push(absErr);
      sqErrs.push(absErr * absErr);
      if ((pred >= 0 && o.actual >= 0) || (pred < 0 && o.actual < 0)) {
        hits += 1;
      }
    }
    absErrorsByArm[armId] = absErrs;
    resultsByArm[armId] = {
      armId,
      horizonMonths,
      selectedParams: devMeta[armId].params,
      devMale: devMeta[armId].devMale,
      nDev: devMeta[armId].nDev,
      n: obs.length,
      male: mean(absErrs),
      rmsle: Math.sqrt(mean(sqErrs)),
      bias: mean(errs),
      hitRate: obs.length > 0 ? hits / obs.length : Number.NaN,
      deltaMaleVsG0: 0,
      deltaBootCi95Low: null,
      deltaBootCi95High: null,
      bootPOneSided: null,
      holmBootP: null,
      nwDmT: null,
      nwPOneSided: null,
      holmNwP: null,
    };
  }

  const g0Errs = absErrorsByArm.G0_incumbent;
  const g0Male = resultsByArm.G0_incumbent.male;
  const bootPValues: number[] = [];
  const nwPValues: number[] = [];

  for (const armId of CHALLENGER_ARMS) {
    const armErrs = absErrorsByArm[armId];
    // Improvement array: >0 means challenger beats G0 (lower MALE -> negative deltaMaleVsG0)
    const imprDiffs = g0Errs.map((e0, k) => e0 - armErrs[k]);
    const nwLag = Math.max(1, horizonMonths - 1);
    const nw = neweyWestDmT(imprDiffs, nwLag);
    const boot = circularBlockBootstrapMeanDiff(imprDiffs, horizonMonths, BOOTSTRAP_REPS, BOOTSTRAP_SEED);

    const row = resultsByArm[armId];
    row.deltaMaleVsG0 = row.male - g0Male;
    // Flip sign back to delta = male(challenger) - male(G0)
    row.deltaBootCi95Low = -boot.upper95;
    row.deltaBootCi95High = -boot.lower95;
    row.bootPOneSided = boot.pOneSided;
    row.nwDmT = nw.tStat;
    row.nwPOneSided = nw.pOneSided;

    bootPValues.push(boot.pOneSided);
    nwPValues.push(nw.pOneSided);
  }

  const holmBoot = holmAdjust(bootPValues);
  const holmNw = holmAdjust(nwPValues);
  CHALLENGER_ARMS.forEach((armId, idx) => {
    resultsByArm[armId].holmBootP = holmBoot[idx];
    resultsByArm[armId].holmNwP = holmNw[idx];
  });

  return ALL_ARMS.map((armId) => resultsByArm[armId]);
}

function buildSubPeriodBreakdown(obs: readonly HoldoutObservation[]): SubPeriodCell[] {
  const buckets = [
    { label: '2004-01..2009-12', start: '2004-01', end: '2009-12' },
    { label: '2010-01..2015-12', start: '2010-01', end: '2015-12' },
    { label: '2016-01..maxMatured', start: '2016-01', end: '9999-12' },
  ];

  const cells: SubPeriodCell[] = [];
  for (const b of buckets) {
    const slice = obs.filter((o) => o.originYm >= b.start && o.originYm <= b.end);
    if (slice.length === 0) continue;
    const maleByArm = {} as Record<GoldLongArmId, number>;
    for (const armId of ALL_ARMS) {
      maleByArm[armId] = mean(slice.map((o) => Math.abs(o.actual - o.preds[armId])));
    }
    const deltaVsG0ByArm = {} as Record<GoldLongArmId, number>;
    for (const armId of ALL_ARMS) {
      deltaVsG0ByArm[armId] = maleByArm[armId] - maleByArm.G0_incumbent;
    }
    cells.push({
      label: b.label,
      originStartYm: slice[0].originYm,
      originEndYm: slice[slice.length - 1].originYm,
      n: slice.length,
      maleByArm,
      deltaVsG0ByArm,
    });
  }
  return cells;
}

function main(): void {
  const rawText = readFileSync(DATA_PATH, 'utf8');
  const datasetSha256 = createHash('sha256').update(rawText).digest('hex');
  const parsed = JSON.parse(rawText) as {
    metadata: Record<string, unknown> & {
      rowCount: number;
      firstMonth: string;
      lastMonth: string;
      lastFullAllFourMonth: string | null;
      missingMonths?: Record<string, string[]>;
    };
    rows: GoldMonthlyRow[];
  };
  const rows = parsed.rows;
  if (!Array.isArray(rows) || rows.length < 600) {
    throw new Error(`Unexpected gold monthly dataset length: ${rows?.length}`);
  }

  const devSelection: Record<number, Record<GoldLongArmId, { params: GoldArmParams; devMale: number; nDev: number }>> = {};
  const holdoutResults: Record<number, HoldoutArmResult[]> = {};
  const subPeriods: Record<number, SubPeriodCell[]> = {};
  const holdoutObsByHorizon: Record<number, HoldoutObservation[]> = {};

  for (const h of GOLD_HORIZONS_MONTHS) {
    const devMap = {} as Record<GoldLongArmId, { params: GoldArmParams; devMale: number; nDev: number }>;
    const paramsMap = {} as Record<GoldLongArmId, GoldArmParams>;
    for (const armId of ALL_ARMS) {
      const sel = selectGoldDevParams(armId, rows, h, 1, DEV_END_YM);
      devMap[armId] = sel;
      paramsMap[armId] = sel.params;
    }
    devSelection[h] = devMap;

    const obs = collectHoldoutObservations(rows, h, paramsMap, 1);
    holdoutObsByHorizon[h] = obs;
    holdoutResults[h] = evaluateHoldoutSlice(obs, h, devMap);
    if (h === 60 || h === 120) {
      subPeriods[h] = buildSubPeriodBreakdown(obs);
    }
  }

  // Macro-lag sensitivity (lag = 2 vs lag = 1 using locked pre-2004 dev params) at 60m and 120m
  const lagSensitivity: LagSensitivityRow[] = [];
  for (const h of [60, 120] as const) {
    const lockedParams = {} as Record<GoldLongArmId, GoldArmParams>;
    for (const armId of ALL_ARMS) {
      lockedParams[armId] = devSelection[h][armId].params;
    }
    const obsLag1 = holdoutObsByHorizon[h];
    const obsLag2 = collectHoldoutObservations(rows, h, lockedParams, 2);
    const evalLag1 = Object.fromEntries(holdoutResults[h].map((r) => [r.armId, r])) as Record<GoldLongArmId, HoldoutArmResult>;
    const evalLag2 = Object.fromEntries(
      evaluateHoldoutSlice(obsLag2, h, devSelection[h]).map((r) => [r.armId, r])
    ) as Record<GoldLongArmId, HoldoutArmResult>;

    for (const armId of MACRO_ARMS) {
      const r1 = evalLag1[armId];
      const r2 = evalLag2[armId];
      lagSensitivity.push({
        armId,
        horizonMonths: h,
        n: r2.n,
        maleLag1: r1.male,
        maleLag2: r2.male,
        deltaMaleVsG0Lag1: r1.deltaMaleVsG0,
        deltaMaleVsG0Lag2: r2.deltaMaleVsG0,
        deltaBootCi95LowLag2: r2.deltaBootCi95Low!,
        deltaBootCi95HighLag2: r2.deltaBootCi95High!,
        bootPOneSidedLag2: r2.bootPOneSided!,
        holmBootPLag2: r2.holmBootP!,
        preservesNegativeSign: r1.deltaMaleVsG0 < 0 && r2.deltaMaleVsG0 < 0,
      });
    }
  }

  // Evaluate pre-registered promotion gate per challenger
  const gateEvaluations: GateEvaluation[] = CHALLENGER_ARMS.map((armId) => {
    const r120 = holdoutResults[120].find((r) => r.armId === armId)!;
    const r60 = holdoutResults[60].find((r) => r.armId === armId)!;
    const lag2_120 = lagSensitivity.find((s) => s.armId === armId && s.horizonMonths === 120) ?? null;

    const passes120mDelta = r120.deltaMaleVsG0 <= -0.05;
    const passes120mCi = (r120.deltaBootCi95High ?? 1) < 0;
    const passes120mHolm = (r120.holmBootP ?? 1) < 0.05;
    const passes60mGuard = r60.deltaMaleVsG0 <= 0.03;

    let passesLag2Sensitivity = true;
    if (lag2_120) {
      passesLag2Sensitivity =
        lag2_120.deltaMaleVsG0Lag2 <= -0.05 &&
        lag2_120.deltaBootCi95HighLag2 < 0 &&
        lag2_120.holmBootPLag2 < 0.05;
    } else {
      passesLag2Sensitivity = passes120mDelta && passes120mCi && passes120mHolm;
    }

    return {
      armId,
      delta120m: r120.deltaMaleVsG0,
      bootCi95High120m: r120.deltaBootCi95High,
      holmBootP120m: r120.holmBootP,
      delta60m: r60.deltaMaleVsG0,
      delta120mLag2: lag2_120 ? lag2_120.deltaMaleVsG0Lag2 : r120.deltaMaleVsG0,
      holmBootPLag2_120m: lag2_120 ? lag2_120.holmBootPLag2 : r120.holmBootP,
      passes120mDelta,
      passes120mCi,
      passes120mHolm,
      passes60mGuard,
      passesLag2Sensitivity,
      passesPreRegisteredGate:
        passes120mDelta &&
        passes120mCi &&
        passes120mHolm &&
        passes60mGuard &&
        passesLag2Sensitivity,
    };
  });

  // Live forward projections from last available month
  const lastIdx = rows.length - 1;
  const lastRow = rows[lastIdx];
  const liveProjections: LiveProjectionRow[] = [];
  for (const h of GOLD_HORIZONS_MONTHS) {
    const targetYm = addMonthsYm(lastRow.ym, h);
    for (const armId of ALL_ARMS) {
      const selectedParams = devSelection[h][armId].params;
      const predLogReturn = predictGoldArm(armId, rows, lastIdx, h, selectedParams, 1);
      if (!Number.isFinite(predLogReturn)) {
        throw new Error(`Non-finite live projection for ${armId} at origin=${lastRow.ym}, h=${h}`);
      }
      const impliedPriceUsd = lastRow.gold * Math.exp(predLogReturn);
      const annualizedCagrPct = (Math.exp(predLogReturn / (h / 12)) - 1) * 100;
      const pctChangeFromSpot = (Math.exp(predLogReturn) - 1) * 100;
      liveProjections.push({
        horizonMonths: h,
        targetYm,
        armId,
        selectedParams,
        predLogReturn,
        impliedPriceUsd,
        annualizedCagrPct,
        pctChangeFromSpot,
      });
    }
  }

  const passingArms = gateEvaluations.filter((g) => g.passesPreRegisteredGate).map((g) => g.armId);
  const gitCommit = safeGitHead();

  const jsonPayload = {
    reportDate: REPORT_DATE,
    gitCommit,
    dataset: {
      path: 'src/data/gold-long-horizon-monthly.json',
      sha256: datasetSha256,
      metadata: parsed.metadata,
    },
    protocol: {
      anchorStartYm: GOLD_ANCHOR_START_YM,
      devOriginStartYm: GOLD_DEV_START_YM,
      devTargetEndYm: DEV_END_YM,
      holdoutOriginStartYm: GOLD_HOLDOUT_START_YM,
      horizonsMonths: GOLD_HORIZONS_MONTHS,
      primaryMacroLagMonths: 1,
      sensitivityMacroLagMonths: 2,
      bootstrapReps: BOOTSTRAP_REPS,
      bootstrapSeed: BOOTSTRAP_SEED,
      promotionGate: {
        deltaMale120mMax: -0.05,
        deltaBootCi95High120mMaxExclusive: 0,
        holmBootP120mMaxExclusive: 0.05,
        deltaMale60mMax: 0.03,
        requiresLag2Consistency: true,
      },
      armDescriptions: ARM_DESCRIPTIONS,
    },
    devSelection,
    holdoutResults,
    subPeriods,
    lagSensitivity,
    gateEvaluations,
    passingArms,
    liveOrigin: {
      ym: lastRow.ym,
      spotUsd: lastRow.gold,
      laggedMacroMonth: rows[lastIdx - 1].ym,
      laggedCpi: rows[lastIdx - 1].cpi,
      laggedM2: rows[lastIdx - 1].m2,
      laggedGs10: rows[lastIdx - 1].gs10,
    },
    liveProjections,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = join(REPORT_DIR, `gold-long-anchor-${REPORT_DATE}.json`);
  const mdPath = join(REPORT_DIR, `gold-long-anchor-${REPORT_DATE}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, 'utf8');

  const lines: string[] = [];
  lines.push(`# Gold Long-Horizon Valuation Anchor Study (${REPORT_DATE})`);
  lines.push('');
  lines.push('Report-only causal out-of-sample benchmark comparing long-horizon valuation anchors for Gold (`USD/oz`) against the current `1Y momentum -> +4%/yr` baseline (`G0_incumbent`). **No production forecast formulas were altered by this research artifact.**');
  lines.push('');
  lines.push('## Verdict Summary');
  lines.push('');
  if (passingArms.length > 0) {
    lines.push(`- **Pre-registered promotion gate:** PASSED by ${passingArms.map((a) => `\`${a}\``).join(', ')} (report-only; pending human review before any production change).`);
  } else {
    lines.push('- **Pre-registered promotion gate:** **NO challenger passed all promotion gates** (remains strictly report-only).');
  }
  const best120 = [...holdoutResults[120]].sort((a, b) => a.male - b.male)[0];
  const g0_120 = holdoutResults[120].find((r) => r.armId === 'G0_incumbent')!;
  const g1_120 = holdoutResults[120].find((r) => r.armId === 'G1_power_law_1971')!;
  lines.push(`- **Lowest 120m (10Y) holdout MALE:** \`${best120.armId}\` (${fmt(best120.male)} vs \`G0_incumbent\` ${fmt(g0_120.male)}, delta ${fmtSigned(best120.deltaMaleVsG0)}, Holm bootstrap p=${fmt(best120.holmBootP, 4)}).`);
  lines.push(`- **Post-1971 Power Law (\`G1_power_law_1971\`) at 120m:** MALE ${fmt(g1_120.male)} (delta ${fmtSigned(g1_120.deltaMaleVsG0)} vs \`G0\`, 95% block-boot CI [${fmtSigned(g1_120.deltaBootCi95Low)}, ${fmtSigned(g1_120.deltaBootCi95High)}], Holm boot p=${fmt(g1_120.holmBootP, 4)}).`);
  lines.push('');
  lines.push('## Dataset & Protocol');
  lines.push('');
  lines.push(`- **Monthly dataset:** \`src/data/gold-long-horizon-monthly.json\` (\`${parsed.metadata.rowCount}\` rows, \`${parsed.metadata.firstMonth}\` -> \`${parsed.metadata.lastMonth}\`, all 4 series populated through \`${parsed.metadata.lastFullAllFourMonth}\`, missing CPI: \`${(parsed.metadata.missingMonths?.cpi ?? []).join(', ') || 'none'}\`; SHA-256 \`${datasetSha256.slice(0, 12)}...\`, git commit \`${gitCommit}\`).`);
  lines.push(`- **Sources:** Spot gold monthly (\`datahub.io/core/gold-prices\`), FRED \`CPIAUCSL\`, \`M2SL\`, and \`GS10\`.`);
  lines.push(`- **Caveats:** Macro series reflect latest-revised FRED vintages rather than point-in-time ALFRED releases; every macro arm enforces \`macroLagMonths >= 1\` (with \`macroLagMonths = 2\` sensitivity check) and missing macro observations (such as FRED \`CPIAUCSL 2025-10\`) resolve strictly causally backward (\`<= origin - macroLagMonths\`).`);
  lines.push(`- **Dev/Holdout split:** Expanding fits anchored at \`${GOLD_ANCHOR_START_YM}\`. Hyperparameters selected strictly on purged pre-2004 dev windows (origins \`>= ${GOLD_DEV_START_YM}\`, matured target \`<= ${DEV_END_YM}\`). Primary out-of-sample evaluation uses origins \`>= ${GOLD_HOLDOUT_START_YM}\` through matured targets \`<= ${parsed.metadata.lastMonth}\`.`);
  lines.push(`- **Inference:** Block bootstrap uses circular moving blocks of length \`h\` months (${BOOTSTRAP_REPS} deterministic draws, seed \`${BOOTSTRAP_SEED}\`) on paired loss improvement (\`|e_G0| - |e_arm|\`, reported back as \`deltaMALE = MALE_arm - MALE_G0\`, so negative delta and CI upper bound \`< 0\` favor the challenger). Holm-Bonferroni correction spans the 6 challengers per horizon. Newey-West HAC DM tests use lag \`h - 1\`.`);
  lines.push('');
  lines.push('## Arms Under Test');
  lines.push('');
  for (const armId of ALL_ARMS) {
    lines.push(`- **\`${armId}\`**: ${ARM_DESCRIPTIONS[armId]}`);
  }
  lines.push('');
  lines.push('## Primary Post-2004 Holdout Results (Lag = 1 Month)');
  lines.push('');
  lines.push('Negative `deltaMALE` means lower absolute log error than `G0_incumbent`. `95% Boot CI` and `Holm Boot p` test one-sided H1 (`MALE_arm < MALE_G0`) across the 6 challengers per horizon.');
  lines.push('');

  for (const h of GOLD_HORIZONS_MONTHS) {
    const res = holdoutResults[h];
    const obs = holdoutObsByHorizon[h];
    lines.push(`### Horizon ${h}m (${(h / 12).toFixed(0)}Y) — n=${obs.length} origins (${obs[0].originYm}..${obs[obs.length - 1].originYm}, targets ${obs[0].targetYm}..${obs[obs.length - 1].targetYm})`);
    lines.push('');
    lines.push('| Arm | Dev Params | Dev MALE | Holdout MALE | RMSLE | Bias | Hit Rate | deltaMALE vs G0 | 95% Boot CI (delta) | Boot p (1s) | Holm Boot p | NW DM t | Holm NW p |');
    lines.push('|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|');
    for (const r of res) {
      const ciStr =
        r.deltaBootCi95Low !== null && r.deltaBootCi95High !== null
          ? `[${fmtSigned(r.deltaBootCi95Low)}, ${fmtSigned(r.deltaBootCi95High)}]`
          : '-';
      lines.push(
        `| \`${r.armId}\` | \`${fmtParams(r.selectedParams)}\` | ${fmt(r.devMale)} | ${fmt(r.male)} | ${fmt(r.rmsle)} | ${fmtSigned(r.bias)} | ${fmtPct(r.hitRate * 100, 1)} | ${r.armId === 'G0_incumbent' ? '0.0000' : fmtSigned(r.deltaMaleVsG0)} | ${ciStr} | ${fmt(r.bootPOneSided)} | ${fmt(r.holmBootP)} | ${fmtSigned(r.nwDmT, 2)} | ${fmt(r.holmNwP)} |`
      );
    }
    lines.push('');
  }

  lines.push('## Pre-Registered Promotion Gate Evaluation');
  lines.push('');
  lines.push('Gate requires ALL of: `120m deltaMALE <= -0.05`, `120m Boot CI upper < 0`, `120m Holm Boot p < 0.05`, `60m deltaMALE <= +0.03`, and preservation under `macroLagMonths = 2`.');
  lines.push('');
  lines.push('| Challenger | 120m deltaMALE | 120m Boot CI High | 120m Holm Boot p | 60m deltaMALE | Lag=2 120m deltaMALE | Lag=2 Holm p | Gate Verdict |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|');
  for (const g of gateEvaluations) {
    lines.push(
      `| \`${g.armId}\` | ${fmtSigned(g.delta120m)} | ${fmtSigned(g.bootCi95High120m)} | ${fmt(g.holmBootP120m)} | ${fmtSigned(g.delta60m)} | ${fmtSigned(g.delta120mLag2)} | ${fmt(g.holmBootPLag2_120m)} | **${g.passesPreRegisteredGate ? 'PASS' : 'FAIL'}** |`
    );
  }
  lines.push('');

  lines.push('## Holdout Sub-Period Breakdown (60m and 120m MALE)');
  lines.push('');
  for (const h of [60, 120] as const) {
    lines.push(`### ${h}m (${h / 12}Y) Sub-Periods`);
    lines.push('');
    lines.push(`| Sub-Period | Origins (n) | ${ALL_ARMS.map((a) => `\`${a}\``).join(' | ')} |`);
    lines.push(`|---|---|${ALL_ARMS.map(() => '---:').join('|')}|`);
    for (const c of subPeriods[h]) {
      const vals = ALL_ARMS.map((a) => {
        const m = fmt(c.maleByArm[a]);
        return a === 'G0_incumbent' ? m : `${m} (${fmtSigned(c.deltaVsG0ByArm[a], 3)})`;
      });
      lines.push(`| ${c.label} | ${c.originStartYm}..${c.originEndYm} (${c.n}) | ${vals.join(' | ')} |`);
    }
    lines.push('');
  }

  lines.push('## Macro Publication-Lag Sensitivity (Lag = 2 Months vs Lag = 1 Month, Locked Dev Params)');
  lines.push('');
  lines.push('| Arm | Horizon | n | Lag=1 MALE | Lag=2 MALE | Lag=1 delta | Lag=2 delta | Lag=2 95% Boot CI | Lag=2 Holm Boot p | Same Negative Sign |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|---:|---|');
  for (const s of lagSensitivity) {
    lines.push(
      `| \`${s.armId}\` | ${s.horizonMonths}m | ${s.n} | ${fmt(s.maleLag1)} | ${fmt(s.maleLag2)} | ${fmtSigned(s.deltaMaleVsG0Lag1)} | ${fmtSigned(s.deltaMaleVsG0Lag2)} | [${fmtSigned(s.deltaBootCi95LowLag2)}, ${fmtSigned(s.deltaBootCi95HighLag2)}] | ${fmt(s.holmBootPLag2)} | ${s.preservesNegativeSign ? 'yes' : 'no'} |`
    );
  }
  lines.push('');

  lines.push(`## Live Forward Projection From ${lastRow.ym} (Spot Gold ${fmtUsd(lastRow.gold)}/oz)`);
  lines.push('');
  lines.push(`Lagged macro anchor at origin \`${lastRow.ym}\` uses \`${rows[lastIdx - 1].ym}\` (\`CPI=${rows[lastIdx - 1].cpi}\`, \`M2=${rows[lastIdx - 1].m2}\`, \`GS10=${rows[lastIdx - 1].gs10}%\`).`);
  lines.push('');
  for (const h of GOLD_HORIZONS_MONTHS) {
    const slice = liveProjections.filter((p) => p.horizonMonths === h);
    lines.push(`### Target ${slice[0].targetYm} (${h}m / ${(h / 12).toFixed(0)}Y)`);
    lines.push('');
    lines.push('| Arm | Selected Dev Params | Pred Log Return | Cumulative Change | Annualized CAGR | Implied Spot Gold |');
    lines.push('|---|---|---:|---:|---:|---:|');
    for (const p of slice) {
      lines.push(
        `| \`${p.armId}\` | \`${fmtParams(p.selectedParams)}\` | ${fmtSigned(p.predLogReturn)} | ${fmtSigned(p.pctChangeFromSpot, 1)}% | ${fmtSigned(p.annualizedCagrPct, 2)}% | ${fmtUsd(p.impliedPriceUsd)} |`
      );
    }
    lines.push('');
  }

  writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[Gold long-anchor] wrote:\n- ${mdPath}\n- ${jsonPath}`);
  if (passingArms.length > 0) {
    console.log(`[Gold long-anchor] GATE PASSING ARMS (report-only): ${passingArms.join(', ')}`);
  } else {
    console.log('[Gold long-anchor] GATE VERDICT: no challenger passed all pre-registered gates.');
  }
}

main();
