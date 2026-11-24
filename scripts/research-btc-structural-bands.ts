import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import {
  addUtcDaysStr,
  circularBlockBootstrapMeanDiff,
  computeCausalLaggedVolByDate,
  fitStructuralBandArm,
  holmAdjust,
  neweyWestDmT,
  pinballLossLog,
  utcDaysSinceGenesis,
  winklerScoreLog,
  winklerScoreOhlcLog,
  type FittedStructuralBandModel,
  type StructuralBandArmId,
} from '../src/lib/btcStructuralBands';

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const REPORT_DATE = '2026-11-24';
const TRAIN_START_PRIMARY = '2011-01-01';
const TRAIN_START_SENSITIVITY = '2013-01-01';
const TRAIN_START_2015 = '2015-01-01';
const TRAIN_END_LOCKED = '2021-12-31';
const HOLDOUT_START = '2022-01-01';
const SUBPERIOD_2025 = '2025-01-01';
const WF_START = '2017-01-01';
const WF_SPACING_DAYS = 90;
const WF_HORIZON_DAYS = 365;
const BOOTSTRAP_REPS = 5000;
const BOOTSTRAP_SEED = 20261124;

const ALL_ARMS: StructuralBandArmId[] = [
  'B0_incumbent',
  'B1_logt_qr',
  'B2_stretched_log_const',
  'B3_stretched_log_decay',
  'B4_logt_decay',
  'B5_stretched_log_rvol',
  'B6_shipped_base_anchored',
];

const CAUSAL_ARMS: StructuralBandArmId[] = [
  'B1_logt_qr',
  'B2_stretched_log_const',
  'B3_stretched_log_decay',
  'B4_logt_decay',
  'B5_stretched_log_rvol',
];

const AUDIT_DATES = [
  '2026-11-20',
  '2028-01-01',
  '2030-01-01',
  '2035-01-01',
  '2040-01-01',
  '2045-01-01',
] as const;

const CYCLE_EXTREMES = [
  { label: '2013 Peak', date: '2013-11-29', kind: 'peak' as const },
  { label: '2015 Low', date: '2015-01-14', kind: 'trough' as const },
  { label: '2017 Peak', date: '2017-12-17', kind: 'peak' as const },
  { label: '2018 Low', date: '2018-12-15', kind: 'trough' as const },
  { label: '2021 Peak', date: '2021-11-10', kind: 'peak' as const },
  { label: '2022 Low', date: '2022-11-21', kind: 'trough' as const },
  { label: '2025 Peak', date: '2025-10-06', kind: 'peak' as const },
  { label: '2026 Low', date: '2026-06-25', kind: 'trough' as const },
] as const;

interface SliceMetrics {
  n: number;
  meanWinkler: number;
  winklerImprPctVsB0: number;
  meanWidthLog: number;
  meanPinballL: number;
  meanPinballU: number;
  coverage: number;
  belowFloorCount: number;
  abovePeakCount: number;
  belowFloorRate: number;
  abovePeakRate: number;
}

interface PairedInference {
  meanWinklerDiff: number;
  winklerImprPct: number;
  boot180: ReturnType<typeof circularBlockBootstrapMeanDiff>;
  boot365: ReturnType<typeof circularBlockBootstrapMeanDiff>;
  nw180: ReturnType<typeof neweyWestDmT>;
  holmP?: number;
}

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
}

function getGitHead(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function evaluateModelOnRows(
  model: FittedStructuralBandModel,
  rows: readonly OHLCVData[],
  alpha: number,
  mode: 'close' | 'ohlc',
  volByDate?: Map<string, number>
): { scores: number[]; metrics: Omit<SliceMetrics, 'winklerImprPctVsB0'> } {
  const tauL = alpha / 2;
  const tauU = 1 - alpha / 2;
  const scores: number[] = [];
  const widths: number[] = [];
  const pinL: number[] = [];
  const pinU: number[] = [];
  let belowCount = 0;
  let aboveCount = 0;
  let coveredCount = 0;

  for (const row of rows) {
    const t = utcDaysSinceGenesis(row.date);
    const vol = volByDate?.get(row.date);
    const band = model.evaluate(t, vol);
    const lowVal = mode === 'ohlc' ? row.low : row.close;
    const highVal = mode === 'ohlc' ? row.high : row.close;

    const score = mode === 'ohlc'
      ? winklerScoreOhlcLog(band.floor, band.peak, row.low, row.high, alpha)
      : winklerScoreLog(band.floor, band.peak, row.close, alpha);

    scores.push(score);
    widths.push(Math.log(band.peak / band.floor));
    pinL.push(pinballLossLog(band.floor, lowVal, tauL));
    pinU.push(pinballLossLog(band.peak, highVal, tauU));

    const below = lowVal < band.floor;
    const above = highVal > band.peak;
    if (below) belowCount++;
    if (above) aboveCount++;
    if (!below && !above) coveredCount++;
  }

  const n = rows.length;
  return {
    scores,
    metrics: {
      n,
      meanWinkler: mean(scores),
      meanWidthLog: mean(widths),
      meanPinballL: mean(pinL),
      meanPinballU: mean(pinU),
      coverage: n > 0 ? coveredCount / n : Number.NaN,
      belowFloorCount: belowCount,
      abovePeakCount: aboveCount,
      belowFloorRate: n > 0 ? belowCount / n : Number.NaN,
      abovePeakRate: n > 0 ? aboveCount / n : Number.NaN,
    },
  };
}

function compareAgainstB0(
  b0Scores: readonly number[],
  candScores: readonly number[],
  b0Mean: number,
  seedOffset: number
): PairedInference {
  const diffs = b0Scores.map((s, i) => s - candScores[i]);
  const meanDiff = mean(diffs);
  const imprPct = b0Mean > 0 ? (meanDiff / b0Mean) * 100 : Number.NaN;
  return {
    meanWinklerDiff: meanDiff,
    winklerImprPct: imprPct,
    boot180: circularBlockBootstrapMeanDiff(diffs, 180, BOOTSTRAP_REPS, BOOTSTRAP_SEED + seedOffset),
    boot365: circularBlockBootstrapMeanDiff(diffs, 365, BOOTSTRAP_REPS, BOOTSTRAP_SEED + 1000 + seedOffset),
    nw180: neweyWestDmT(diffs, 180),
  };
}

function runStructuralAudit(model: FittedStructuralBandModel) {
  let inversionCount = 0;
  let firstInversionDate: string | null = null;
  let totalChecked = 0;

  for (let d = '2011-01-01'; d <= '2045-12-31'; d = addUtcDaysStr(d, 1)) {
    totalChecked++;
    const b = model.evaluate(utcDaysSinceGenesis(d));
    const invalid =
      !Number.isFinite(b.floor) ||
      !Number.isFinite(b.center) ||
      !Number.isFinite(b.peak) ||
      b.floor <= 0 ||
      b.floor >= b.center ||
      b.center >= b.peak ||
      b.floor >= b.peak;
    if (invalid) {
      inversionCount++;
      if (!firstInversionDate) firstInversionDate = d;
    }
  }

  const checkpoints = Object.fromEntries(
    AUDIT_DATES.map(d => {
      const b = model.evaluate(utcDaysSinceGenesis(d));
      return [
        d,
        {
          floor: Number(b.floor.toFixed(2)),
          center: Number(b.center.toFixed(2)),
          peak: Number(b.peak.toFixed(2)),
          widthRatio: Number((b.peak / b.floor).toFixed(2)),
        },
      ];
    })
  );

  return {
    totalCheckedDays: totalChecked,
    inversionCount,
    firstInversionDate,
    checkpoints,
  };
}

function runProtocol1Variant(
  rows: readonly OHLCVData[],
  options: {
    label: string;
    trainStartDate: string;
    trainEndDate: string;
    alpha: number;
    mode: 'close' | 'ohlc';
    arms: StructuralBandArmId[];
  }
) {
  const holdoutRows = rows.filter(r => r.date >= HOLDOUT_START);
  const sub22_24Idx = holdoutRows.map((r, i) => (r.date < SUBPERIOD_2025 ? i : -1)).filter(i => i >= 0);
  const sub25_26Idx = holdoutRows.map((r, i) => (r.date >= SUBPERIOD_2025 ? i : -1)).filter(i => i >= 0);

  const models = new Map<StructuralBandArmId, FittedStructuralBandModel>();
  for (const arm of options.arms) {
    models.set(
      arm,
      fitStructuralBandArm(arm, rows, {
        trainStartDate: options.trainStartDate,
        trainEndDate: options.trainEndDate,
        alpha: options.alpha,
      })
    );
  }

  const evals = new Map<string, ReturnType<typeof evaluateModelOnRows>>();
  for (const [arm, model] of models.entries()) {
    evals.set(arm, evaluateModelOnRows(model, holdoutRows, options.alpha, options.mode));
  }

  // Diagnostic: daily 1-day-lagged realized volatility version of B5
  if (models.has('B5_stretched_log_rvol')) {
    const b5Model = models.get('B5_stretched_log_rvol')!;
    const winDays = Number(b5Model.params.windowDays ?? 365);
    const latestDate = rows[rows.length - 1].date;
    const dynamicVolMap = computeCausalLaggedVolByDate(rows, latestDate, winDays);
    evals.set('B5_dynamic_lag1_diag', evaluateModelOnRows(b5Model, holdoutRows, options.alpha, options.mode, dynamicVolMap));
  }

  const b0Eval = evals.get('B0_incumbent')!;
  const b0Mean = b0Eval.metrics.meanWinkler;

  const armSummaries: Record<string, {
    params: Record<string, number | string | boolean | null>;
    fullHoldout: SliceMetrics;
    sub2022_2024: SliceMetrics;
    sub2025_2026: SliceMetrics;
    inference: PairedInference | null;
    structuralAudit: ReturnType<typeof runStructuralAudit> | null;
  }> = {};

  const causalEntries: { key: string; inference: PairedInference }[] = [];

  for (const [key, res] of evals.entries()) {
    const sub22_24Scores = sub22_24Idx.map(i => res.scores[i]);
    const sub25_26Scores = sub25_26Idx.map(i => res.scores[i]);
    const b0Sub22_24 = mean(sub22_24Idx.map(i => b0Eval.scores[i]));
    const b0Sub25_26 = mean(sub25_26Idx.map(i => b0Eval.scores[i]));

    const sub22_24Eval = evaluateModelOnRows(
      models.get(key as StructuralBandArmId) ?? models.get('B5_stretched_log_rvol')!,
      sub22_24Idx.map(i => holdoutRows[i]),
      options.alpha,
      options.mode,
      key === 'B5_dynamic_lag1_diag'
        ? computeCausalLaggedVolByDate(rows, rows[rows.length - 1].date, Number(models.get('B5_stretched_log_rvol')!.params.windowDays ?? 365))
        : undefined
    );
    const sub25_26Eval = evaluateModelOnRows(
      models.get(key as StructuralBandArmId) ?? models.get('B5_stretched_log_rvol')!,
      sub25_26Idx.map(i => holdoutRows[i]),
      options.alpha,
      options.mode,
      key === 'B5_dynamic_lag1_diag'
        ? computeCausalLaggedVolByDate(rows, rows[rows.length - 1].date, Number(models.get('B5_stretched_log_rvol')!.params.windowDays ?? 365))
        : undefined
    );

    const inference = key === 'B0_incumbent'
      ? null
      : compareAgainstB0(b0Eval.scores, res.scores, b0Mean, key.length * 17 + Math.round(options.alpha * 100));

    if (inference && CAUSAL_ARMS.includes(key as StructuralBandArmId)) {
      causalEntries.push({ key, inference });
    }

    armSummaries[key] = {
      params: models.get(key as StructuralBandArmId)?.params ?? { diagnostic: 'B5 with daily lagged rvol' },
      fullHoldout: {
        ...res.metrics,
        winklerImprPctVsB0: b0Mean > 0 ? (1 - res.metrics.meanWinkler / b0Mean) * 100 : 0,
      },
      sub2022_2024: {
        ...sub22_24Eval.metrics,
        meanWinkler: mean(sub22_24Scores),
        winklerImprPctVsB0: b0Sub22_24 > 0 ? (1 - mean(sub22_24Scores) / b0Sub22_24) * 100 : 0,
      },
      sub2025_2026: {
        ...sub25_26Eval.metrics,
        meanWinkler: mean(sub25_26Scores),
        winklerImprPctVsB0: b0Sub25_26 > 0 ? (1 - mean(sub25_26Scores) / b0Sub25_26) * 100 : 0,
      },
      inference,
      structuralAudit: models.has(key as StructuralBandArmId) ? runStructuralAudit(models.get(key as StructuralBandArmId)!) : null,
    };
  }

  // Holm correction across the 5 causal arms B1..B5
  if (causalEntries.length > 0) {
    const adjusted = holmAdjust(causalEntries.map(e => e.inference.nw180.pOneSided));
    causalEntries.forEach((e, idx) => {
      e.inference.holmP = adjusted[idx];
    });
  }

  return {
    label: options.label,
    trainStartDate: options.trainStartDate,
    trainEndDate: options.trainEndDate,
    holdoutStartDate: holdoutRows[0]?.date ?? HOLDOUT_START,
    holdoutEndDate: holdoutRows[holdoutRows.length - 1]?.date ?? '',
    holdoutRows: holdoutRows.length,
    alpha: options.alpha,
    mode: options.mode,
    arms: armSummaries,
  };
}

function runProtocol2WalkForward(rows: readonly OHLCVData[]) {
  const wfStartIdx = rows.findIndex(r => r.date >= WF_START);
  const lastEligibleOriginIdx = rows.length - 1 - WF_HORIZON_DAYS;
  const originIndices: number[] = [];
  for (let idx = wfStartIdx; idx <= lastEligibleOriginIdx; idx += WF_SPACING_DAYS) {
    originIndices.push(idx);
  }

  const origins: {
    originDate: string;
    targetEndDate: string;
    byArm: Record<string, { meanWinkler: number; coverage: number; meanWidthLog: number }>;
  }[] = [];

  for (const originIdx of originIndices) {
    const originDate = rows[originIdx].date;
    const forwardRows = rows.slice(originIdx + 1, originIdx + 1 + WF_HORIZON_DAYS);
    const byArm: Record<string, { meanWinkler: number; coverage: number; meanWidthLog: number }> = {};

    for (const arm of ALL_ARMS) {
      const model = fitStructuralBandArm(arm, rows, {
        trainStartDate: TRAIN_START_PRIMARY,
        trainEndDate: originDate,
        alpha: 0.05,
      });
      const evaluated = evaluateModelOnRows(model, forwardRows, 0.05, 'close');
      byArm[arm] = {
        meanWinkler: evaluated.metrics.meanWinkler,
        coverage: evaluated.metrics.coverage,
        meanWidthLog: evaluated.metrics.meanWidthLog,
      };
    }

    origins.push({
      originDate,
      targetEndDate: forwardRows[forwardRows.length - 1].date,
      byArm,
    });
  }

  const summarizeEra = (subset: typeof origins) => {
    const b0Means = subset.map(o => o.byArm.B0_incumbent.meanWinkler);
    const b0Overall = mean(b0Means);
    const summary: Record<string, {
      origins: number;
      meanWinkler: number;
      winklerImprPctVsB0: number;
      meanCoverage: number;
      meanWidthLog: number;
      originWinRateVsB0: number;
      boot4Q: ReturnType<typeof circularBlockBootstrapMeanDiff> | null;
    }> = {};

    for (const arm of ALL_ARMS) {
      const armMeans = subset.map(o => o.byArm[arm].meanWinkler);
      const armCovs = subset.map(o => o.byArm[arm].coverage);
      const armWidths = subset.map(o => o.byArm[arm].meanWidthLog);
      const diffs = subset.map((o, i) => b0Means[i] - armMeans[i]);
      const wins = diffs.filter(d => d > 0).length;
      const mW = mean(armMeans);

      summary[arm] = {
        origins: subset.length,
        meanWinkler: mW,
        winklerImprPctVsB0: b0Overall > 0 ? (1 - mW / b0Overall) * 100 : 0,
        meanCoverage: mean(armCovs),
        meanWidthLog: mean(armWidths),
        originWinRateVsB0: subset.length > 0 ? wins / subset.length : 0,
        boot4Q: arm === 'B0_incumbent' ? null : circularBlockBootstrapMeanDiff(diffs, 4, BOOTSTRAP_REPS, BOOTSTRAP_SEED + arm.length * 31),
      };
    }
    return summary;
  };

  return {
    originCount: origins.length,
    firstOrigin: origins[0]?.originDate ?? null,
    lastOrigin: origins[origins.length - 1]?.originDate ?? null,
    spacingDays: WF_SPACING_DAYS,
    horizonDays: WF_HORIZON_DAYS,
    pooled2017_2026: summarizeEra(origins),
    pre2022_2017_2021: summarizeEra(origins.filter(o => o.originDate < HOLDOUT_START)),
    post2022_2022_2026: summarizeEra(origins.filter(o => o.originDate >= HOLDOUT_START)),
  };
}

function buildCycleDiagnostics(rows: readonly OHLCVData[], models: Map<StructuralBandArmId, FittedStructuralBandModel>) {
  const byDate = new Map(rows.map(r => [r.date, r]));
  return CYCLE_EXTREMES.map(ext => {
    const row = byDate.get(ext.date);
    if (!row) return null;
    const t = utcDaysSinceGenesis(ext.date);
    const actualExtreme = ext.kind === 'peak' ? row.high : row.low;
    const predictions: Record<string, {
      floor: number;
      center: number;
      peak: number;
      extremeRatio: number;
      closeRatio: number;
    }> = {};
    for (const [arm, model] of models.entries()) {
      const b = model.evaluate(t);
      predictions[arm] = {
        floor: Number(b.floor.toFixed(2)),
        center: Number(b.center.toFixed(2)),
        peak: Number(b.peak.toFixed(2)),
        extremeRatio: Number((ext.kind === 'peak' ? actualExtreme / b.peak : actualExtreme / b.floor).toFixed(3)),
        closeRatio: Number((ext.kind === 'peak' ? row.close / b.peak : row.close / b.floor).toFixed(3)),
      };
    }
    return {
      label: ext.label,
      date: ext.date,
      kind: ext.kind,
      t,
      actualClose: row.close,
      actualExtreme,
      predictions,
    };
  }).filter(Boolean);
}

function pct(v: number, digits = 2): string {
  return Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` : 'n/a';
}

function num(v: number, digits = 4): string {
  return Number.isFinite(v) ? v.toFixed(digits) : 'n/a';
}

function usd(v: number): string {
  if (!Number.isFinite(v)) return 'n/a';
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`;
  return `$${v.toFixed(2)}`;
}

function main() {
  const rawJson = readFileSync(join(process.cwd(), 'src', 'data', 'btc-history.json'), 'utf8');
  const btcSha256 = createHash('sha256').update(rawJson).digest('hex');
  const rows = btcHistory as OHLCVData[];

  // Primary Protocol 1 (alpha = 0.05, close, trained 2011-01-01..2021-12-31)
  const p1Primary = runProtocol1Variant(rows, {
    label: 'Protocol 1 Primary (95% close, train 2011-01-01..2021-12-31)',
    trainStartDate: TRAIN_START_PRIMARY,
    trainEndDate: TRAIN_END_LOCKED,
    alpha: 0.05,
    mode: 'close',
    arms: ALL_ARMS,
  });

  // Secondary 98% extreme envelope (alpha = 0.02)
  const p1Extreme98 = runProtocol1Variant(rows, {
    label: 'Protocol 1 Secondary (98% extreme close, train 2011-01-01..2021-12-31)',
    trainStartDate: TRAIN_START_PRIMARY,
    trainEndDate: TRAIN_END_LOCKED,
    alpha: 0.02,
    mode: 'close',
    arms: ALL_ARMS,
  });

  // Secondary OHLC extremes (alpha = 0.05, low/high)
  const p1Ohlc = runProtocol1Variant(rows, {
    label: 'Protocol 1 Secondary (95% OHLC low/high, train 2011-01-01..2021-12-31)',
    trainStartDate: TRAIN_START_PRIMARY,
    trainEndDate: TRAIN_END_LOCKED,
    alpha: 0.05,
    mode: 'ohlc',
    arms: ALL_ARMS,
  });

  // Sensitivity: 2013-01-01 training start
  const p1Train2013 = runProtocol1Variant(rows, {
    label: 'Sensitivity (95% close, train 2013-01-01..2021-12-31)',
    trainStartDate: TRAIN_START_SENSITIVITY,
    trainEndDate: TRAIN_END_LOCKED,
    alpha: 0.05,
    mode: 'close',
    arms: ALL_ARMS,
  });

  // Diagnostic: B6 anchored on 2015-01-01..2021-12-31
  const p1B6_2015 = runProtocol1Variant(rows, {
    label: 'Diagnostic B6 (95% close, train 2015-01-01..2021-12-31)',
    trainStartDate: TRAIN_START_2015,
    trainEndDate: TRAIN_END_LOCKED,
    alpha: 0.05,
    mode: 'close',
    arms: ['B0_incumbent', 'B6_shipped_base_anchored'],
  });

  // Protocol 2: Expanding 1-year-ahead rolling walk-forward
  const p2WalkForward = runProtocol2WalkForward(rows);

  // Latest-fit illustrative models (2011-01-01..latest) for 2026-2045 structural corridor projection
  const latestDate = rows[rows.length - 1].date;
  const latestModels = new Map<StructuralBandArmId, FittedStructuralBandModel>();
  const lockedModels = new Map<StructuralBandArmId, FittedStructuralBandModel>();
  for (const arm of ALL_ARMS) {
    lockedModels.set(
      arm,
      fitStructuralBandArm(arm, rows, {
        trainStartDate: TRAIN_START_PRIMARY,
        trainEndDate: TRAIN_END_LOCKED,
        alpha: 0.05,
      })
    );
    latestModels.set(
      arm,
      fitStructuralBandArm(arm, rows, {
        trainStartDate: TRAIN_START_PRIMARY,
        trainEndDate: latestDate,
        alpha: 0.05,
      })
    );
  }
  const latestAudits = Object.fromEntries(
    [...latestModels.entries()].map(([arm, model]) => [
      arm,
      {
        params: model.params,
        audit: runStructuralAudit(model),
      },
    ])
  );

  const cycleDiagnosticsLocked = buildCycleDiagnostics(rows, lockedModels);

  // Pre-registered promotion gates on causal arms B1..B5 (plus diagnostic check for B6)
  const gateResults = ALL_ARMS.filter(a => a !== 'B0_incumbent').map(arm => {
    const p1 = p1Primary.arms[arm];
    const p2 = p2WalkForward.pooled2017_2026[arm];
    const zeroInversions = p1.structuralAudit?.inversionCount === 0;
    const minGain5Pct = (p1.fullHoldout.winklerImprPctVsB0 ?? -Infinity) >= 5.0;
    const positiveBoot180 = (p1.inference?.boot180.lower95 ?? -Infinity) > 0;
    const holmSig = arm === 'B6_shipped_base_anchored'
      ? (p1.inference?.nw180.pOneSided ?? 1) < 0.05
      : (p1.inference?.holmP ?? 1) < 0.05;
    const positiveSub22_24 = p1.sub2022_2024.winklerImprPctVsB0 > 0;
    const positiveSub25_26 = p1.sub2025_2026.winklerImprPctVsB0 > 0;
    const positiveWf = p2.winklerImprPctVsB0 > 0;
    const validCov = p1.fullHoldout.coverage >= 0.88 && p1.fullHoldout.coverage <= 0.995;

    const passed =
      arm !== 'B6_shipped_base_anchored' &&
      zeroInversions &&
      minGain5Pct &&
      positiveBoot180 &&
      holmSig &&
      positiveSub22_24 &&
      positiveSub25_26 &&
      positiveWf &&
      validCov;

    return {
      arm,
      causal: arm !== 'B6_shipped_base_anchored',
      passed,
      checks: {
        zeroInversions,
        minGain5Pct,
        positiveBoot180,
        holmSig,
        positiveSub22_24,
        positiveSub25_26,
        positiveWf,
        validCov,
      },
      summary: {
        holdoutWinklerImprPct: p1.fullHoldout.winklerImprPctVsB0,
        boot180Lower95: p1.inference?.boot180.lower95 ?? null,
        holmP: p1.inference?.holmP ?? null,
        nwOneSidedP: p1.inference?.nw180.pOneSided ?? null,
        sub22_24Pct: p1.sub2022_2024.winklerImprPctVsB0,
        sub25_26Pct: p1.sub2025_2026.winklerImprPctVsB0,
        wf2017_2026Pct: p2.winklerImprPctVsB0,
        coverage: p1.fullHoldout.coverage,
        inversionsThrough2045: p1.structuralAudit?.inversionCount ?? null,
      },
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    gitCommit: getGitHead(),
    btcData: {
      rows: rows.length,
      firstDate: rows[0]?.date,
      lastDate: latestDate,
      sha256: btcSha256,
    },
    protocol1Primary: p1Primary,
    protocol1Extreme98: p1Extreme98,
    protocol1Ohlc: p1Ohlc,
    protocol1Train2013: p1Train2013,
    protocol1B6_2015: p1B6_2015,
    protocol2WalkForward: p2WalkForward,
    latestFitStructuralAudits: latestAudits,
    cycleDiagnosticsLocked,
    gateResults,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = join(REPORT_DIR, `btc-structural-bands-${REPORT_DATE}.json`);
  const mdPath = join(REPORT_DIR, `btc-structural-bands-${REPORT_DATE}.md`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const lines: string[] = [];
  lines.push(`# BTC Structural Top & Bottom Bands Evaluation — ${REPORT_DATE}`);
  lines.push('');
  lines.push(`- Generated: ${payload.generatedAt}`);
  lines.push(`- Git commit: \`${payload.gitCommit}\``);
  lines.push(`- Dataset: \`src/data/btc-history.json\` (${rows.length} rows, \`${rows[0]?.date}\` → \`${latestDate}\`, SHA-256 \`${btcSha256}\`)`);
  lines.push(`- Status: **Report-only** (no production forecast or UI change)`);
  lines.push('');
  lines.push('## Gate Verdicts (Pre-Registered)');
  lines.push('');
  lines.push('| Arm | Causal | Gate Verdict | Holdout Δ% | Boot180 Lo95 | Holm p | 22–24 Δ% | 25–26 Δ% | WF 17–26 Δ% | Cov | Inversions (2011–2045) |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const g of gateResults) {
    lines.push(
      `| \`${g.arm}\` | ${g.causal ? 'yes' : 'no (ablation)'} | ${g.passed ? '**PASS**' : 'FAIL'} | ${pct(g.summary.holdoutWinklerImprPct)} | ${num(g.summary.boot180Lower95 ?? Number.NaN, 4)} | ${g.summary.holmP === null ? 'n/a' : num(g.summary.holmP, 4)} | ${pct(g.summary.sub22_24Pct)} | ${pct(g.summary.sub25_26Pct)} | ${pct(g.summary.wf2017_2026Pct)} | ${(g.summary.coverage * 100).toFixed(1)}% | ${g.summary.inversionsThrough2045} |`
    );
  }
  lines.push('');
  lines.push('## Protocol 1 — Locked Out-of-Sample Holdout (2022-01-01 → ' + latestDate + ', α = 0.05 close)');
  lines.push('');
  lines.push('Trained strictly on `2011-01-01 → 2021-12-31` (`n = ' + p1Primary.holdoutRows + '` holdout days).');
  lines.push('');
  lines.push('| Arm | Winkler | Δ% vs B0 | Width (log) | Cov (95% target) | Below / Above | Pinball L | Pinball U | NW-DM t (Holm p) | Boot365 Lo95 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |');
  for (const [key, arm] of Object.entries(p1Primary.arms)) {
    const f = arm.fullHoldout;
    const inf = arm.inference;
    const dmStr = inf ? `${inf.nw180.tStat.toFixed(2)} (${inf.holmP !== undefined ? inf.holmP.toFixed(4) : inf.nw180.pOneSided.toFixed(4)})` : '—';
    const b365 = inf ? num(inf.boot365.lower95, 4) : '—';
    lines.push(
      `| \`${key}\` | ${num(f.meanWinkler, 4)} | ${key === 'B0_incumbent' ? '—' : pct(f.winklerImprPctVsB0)} | ${num(f.meanWidthLog, 3)} | ${(f.coverage * 100).toFixed(2)}% | ${f.belowFloorCount} / ${f.abovePeakCount} | ${num(f.meanPinballL, 4)} | ${num(f.meanPinballU, 4)} | ${dmStr} | ${b365} |`
    );
  }
  lines.push('');
  lines.push('### Protocol 1 Secondary Targets & Sensitivities (Holdout 2022–2026)');
  lines.push('');
  lines.push('| Arm | 98% Close Winkler (Δ%) | 98% Cov | OHLC 95% Winkler (Δ%) | OHLC Cov | Train 2013+ Winkler (Δ%) |');
  lines.push('| --- | --- | ---: | --- | ---: | --- |');
  for (const arm of ALL_ARMS) {
    const e98 = p1Extreme98.arms[arm].fullHoldout;
    const ohlc = p1Ohlc.arms[arm].fullHoldout;
    const t13 = p1Train2013.arms[arm].fullHoldout;
    lines.push(
      `| \`${arm}\` | ${num(e98.meanWinkler, 4)} (${pct(e98.winklerImprPctVsB0)}) | ${(e98.coverage * 100).toFixed(1)}% | ${num(ohlc.meanWinkler, 4)} (${pct(ohlc.winklerImprPctVsB0)}) | ${(ohlc.coverage * 100).toFixed(1)}% | ${num(t13.meanWinkler, 4)} (${pct(t13.winklerImprPctVsB0)}) |`
    );
  }
  lines.push('');
  lines.push(`- Diagnostic \`B6_shipped_base_anchored\` trained on \`2015-01-01 → 2021-12-31\`: Winkler = \`${num(p1B6_2015.arms.B6_shipped_base_anchored.fullHoldout.meanWinkler, 4)}\` (${pct(p1B6_2015.arms.B6_shipped_base_anchored.fullHoldout.winklerImprPctVsB0)} vs B0), width = \`${num(p1B6_2015.arms.B6_shipped_base_anchored.fullHoldout.meanWidthLog, 3)}\`, coverage = \`${(p1B6_2015.arms.B6_shipped_base_anchored.fullHoldout.coverage * 100).toFixed(2)}%\`.`);
  lines.push('');
  lines.push('## Protocol 2 — Expanding Causal 1-Year-Ahead Rolling Walk-Forward');
  lines.push('');
  lines.push(`Quarterly origins (\`spacing = ${WF_SPACING_DAYS}d\`, \`horizon = ${WF_HORIZON_DAYS}d\`, \`${p2WalkForward.originCount}\` origins from \`${p2WalkForward.firstOrigin}\` to \`${p2WalkForward.lastOrigin}\`).`);
  lines.push('');
  lines.push('| Arm | 2017–2026 Winkler (Δ%) | Win Rate | Boot4Q Lo95 | 2017–2021 Δ% | 2022–2026 Δ% | Mean Cov |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const arm of ALL_ARMS) {
    const pAll = p2WalkForward.pooled2017_2026[arm];
    const pPre = p2WalkForward.pre2022_2017_2021[arm];
    const pPost = p2WalkForward.post2022_2022_2026[arm];
    lines.push(
      `| \`${arm}\` | ${num(pAll.meanWinkler, 4)} (${arm === 'B0_incumbent' ? '—' : pct(pAll.winklerImprPctVsB0)}) | ${(pAll.originWinRateVsB0 * 100).toFixed(0)}% | ${pAll.boot4Q ? num(pAll.boot4Q.lower95, 4) : '—'} | ${arm === 'B0_incumbent' ? '—' : pct(pPre.winklerImprPctVsB0)} | ${arm === 'B0_incumbent' ? '—' : pct(pPost.winklerImprPctVsB0)} | ${(pAll.meanCoverage * 100).toFixed(1)}% |`
    );
  }
  lines.push('');
  lines.push('## Structural Future Audit (2011-01-01 → 2045-12-31, Pre-2022 Locked Fits)');
  lines.push('');
  lines.push('| Arm | Selected Params | Inversions | First Inversion | 2026-11-20 (Fl / Ctr / Pk) | 2035-01-01 (Fl / Ctr / Pk) | 2045-01-01 (Fl / Ctr / Pk) |');
  lines.push('| --- | --- | ---: | --- | --- | --- | --- |');
  for (const arm of ALL_ARMS) {
    const a = p1Primary.arms[arm];
    const aud = a.structuralAudit!;
    const cp26 = aud.checkpoints['2026-11-20'];
    const cp35 = aud.checkpoints['2035-01-01'];
    const cp45 = aud.checkpoints['2045-01-01'];
    const paramStr = arm === 'B0_incumbent'
      ? 'shipped'
      : Object.entries(a.params)
          .filter(([k]) => ['gamma', 'beta', 'windowDays', 'slopeL', 'slopeU', 'zL', 'zU'].includes(k))
          .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(3) : v}`)
          .join(', ');
    lines.push(
      `| \`${arm}\` | \`${paramStr}\` | ${aud.inversionCount} | ${aud.firstInversionDate ?? 'none'} | ${usd(cp26.floor)} / ${usd(cp26.center)} / ${usd(cp26.peak)} | ${usd(cp35.floor)} / ${usd(cp35.center)} / ${usd(cp35.peak)} | ${usd(cp45.floor)} / ${usd(cp45.center)} / ${usd(cp45.peak)} |`
    );
  }
  lines.push('');
  lines.push('## Cycle-Extremes Diagnostic (Pre-2022 Locked Fits)');
  lines.push('');
  lines.push('| Event | Actual Extreme | B0 Band (Fl / Pk) | B0 Ratio | B3 Band (Fl / Pk) | B3 Ratio | B4 Band (Fl / Pk) | B4 Ratio |');
  lines.push('| --- | ---: | --- | ---: | --- | ---: | --- | ---: |');
  for (const row of cycleDiagnosticsLocked as NonNullable<ReturnType<typeof buildCycleDiagnostics>[number]>[]) {
    const b0 = row.predictions.B0_incumbent;
    const b3 = row.predictions.B3_stretched_log_decay;
    const b4 = row.predictions.B4_logt_decay;
    lines.push(
      `| ${row.label} (${row.date}) | ${usd(row.actualExtreme)} | ${usd(b0.floor)} / ${usd(b0.peak)} | ${b0.extremeRatio.toFixed(2)}x | ${usd(b3.floor)} / ${usd(b3.peak)} | ${b3.extremeRatio.toFixed(2)}x | ${usd(b4.floor)} / ${usd(b4.peak)} | ${b4.extremeRatio.toFixed(2)}x |`
    );
  }
  lines.push('');
  lines.push('## Limitations & Methodological Caveats');
  lines.push('');
  lines.push('- **Low-frequency effective sample size:** BTC exhibits ~4-year halving/liquidity cycles, so the `2022-01-01 → ' + latestDate + '` holdout (~4.9 years) contains only ~1.2 independent macro cycles (`~1` cycle trough in Nov 2022 and `~1` cycle peak in Oct 2025). Daily block-bootstrap (`B=180/365`) and HAC-DM tests quantify autocorrelation at sub-annual scales, not multi-year cycle independence.');
  lines.push('- **Incumbent lookback asymmetry:** `B0_incumbent` uses fixed historical coefficients (`POWER_LAW_CONFIG`) tuned using post-2021 awareness, whereas `B1..B5` are fitted strictly on pre-2022 data (`<= 2021-12-31`).');
  lines.push('- **Vintage caveat:** `src/data/btc-history.json` is latest-revised OHLCV rather than point-in-time archival snapshots.');
  lines.push('');

  writeFileSync(mdPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}`);
  console.log('\n--- GATE SUMMARY ---');
  for (const g of gateResults) {
    console.log(
      `${g.arm.padEnd(24)} | passed=${String(g.passed).padEnd(5)} | holdout=${pct(g.summary.holdoutWinklerImprPct).padStart(7)} | boot180Lo=${num(g.summary.boot180Lower95 ?? NaN, 4).padStart(7)} | holmP=${(g.summary.holmP === null ? 'n/a' : num(g.summary.holmP, 4)).padStart(6)} | 22-24=${pct(g.summary.sub22_24Pct).padStart(7)} | 25-26=${pct(g.summary.sub25_26Pct).padStart(7)} | wf17-26=${pct(g.summary.wf2017_2026Pct).padStart(7)} | cov=${(g.summary.coverage * 100).toFixed(1)}% | inv=${g.summary.inversionsThrough2045}`
    );
  }
}

main();
