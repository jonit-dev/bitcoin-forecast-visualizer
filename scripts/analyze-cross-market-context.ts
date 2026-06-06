import btcHistory from '../src/data/btc-history.json';
import vooHistory from '../src/data/voo-history.json';
import type { OHLCVData } from '../src/lib/api';

const WINDOWS = [30, 90, 180, 365] as const;
const REPORT_DIR = 'docs/reports/results';

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}

function correlation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return 0;
  const meanA = mean(a);
  const meanB = mean(b);
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  return varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : 0;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

function alignedReturns(btc: OHLCVData[], voo: OHLCVData[]) {
  const vooByDate = new Map(voo.map((row) => [row.date, row]));
  const btcByDate = new Map(btc.map((row) => [row.date, row]));
  const dates = [...btcByDate.keys()].filter((date) => vooByDate.has(date)).sort();
  const rows = [] as { date: string; btc: number; sp500: number; btcClose: number; sp500Close: number }[];
  for (let i = 1; i < dates.length; i++) {
    const prevDate = dates[i - 1];
    const date = dates[i];
    const prevBtc = btcByDate.get(prevDate)!;
    const currentBtc = btcByDate.get(date)!;
    const prevVoo = vooByDate.get(prevDate)!;
    const currentVoo = vooByDate.get(date)!;
    if (prevBtc.close <= 0 || currentBtc.close <= 0 || prevVoo.close <= 0 || currentVoo.close <= 0) continue;
    rows.push({
      date,
      btc: Math.log(currentBtc.close / prevBtc.close),
      sp500: Math.log(currentVoo.close / prevVoo.close),
      btcClose: currentBtc.close,
      sp500Close: currentVoo.close,
    });
  }
  return rows;
}

function rollingStats(rows: ReturnType<typeof alignedReturns>, window: number) {
  const out = [] as Array<{ date: string; corr: number; beta: number; btcVol: number; sp500Vol: number; btcRelReturn: number }>;
  for (let i = window; i < rows.length; i++) {
    const slice = rows.slice(i - window, i);
    const btc = slice.map((row) => row.btc);
    const sp = slice.map((row) => row.sp500);
    const corr = correlation(btc, sp);
    const spVar = sampleSd(sp) ** 2;
    const beta = spVar > 0 ? corr * sampleSd(btc) / sampleSd(sp) : 0;
    out.push({
      date: rows[i].date,
      corr,
      beta,
      btcVol: sampleSd(btc) * Math.sqrt(252),
      sp500Vol: sampleSd(sp) * Math.sqrt(252),
      btcRelReturn: Math.log(rows[i].btcClose / rows[i - window].btcClose) - Math.log(rows[i].sp500Close / rows[i - window].sp500Close),
    });
  }
  return out;
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

async function main() {
  const rows = alignedReturns(btcHistory as OHLCVData[], vooHistory as OHLCVData[]);
  const latest = rows.at(-1)!;
  const windows = Object.fromEntries(WINDOWS.map((window) => {
    const series = rollingStats(rows, window);
    const latestStats = series.at(-1)!;
    const corrHistory = series.map((row) => row.corr);
    const betaHistory = series.map((row) => row.beta);
    return [String(window), {
      latest: latestStats,
      corrP10: quantile(corrHistory, 0.10),
      corrMedian: quantile(corrHistory, 0.50),
      corrP90: quantile(corrHistory, 0.90),
      betaMedian: quantile(betaHistory, 0.50),
      samples: series.length,
    }];
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    alignedTradingRows: rows.length,
    firstDate: rows[0].date,
    latestDate: latest.date,
    latestBtcClose: latest.btcClose,
    latestSp500Close: latest.sp500Close,
    windows,
    verdict: 'PROMOTE AS CONTEXT: rolling BTC↔S&P correlation/beta is not a point-forecast edge by itself, but it is valuable regime context because it tells whether BTC is behaving like high-beta risk-on tech/liquidity exposure or idiosyncratic crypto. Use for UI interpretation, not forecast override.',
  };

  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `cross-market-context-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `cross-market-context-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    '# BTC ↔ S&P 500 Cross-Market Context Probe',
    '',
    `Generated: ${report.generatedAt}`,
    `Data: ${report.alignedTradingRows} aligned BTC/VOO trading rows, ${report.firstDate} → ${report.latestDate}.`,
    '',
    '## Latest rolling stats',
    ...WINDOWS.map((window) => {
      const item: any = report.windows[String(window)];
      return `- ${window}d: corr=${item.latest.corr.toFixed(2)}, beta=${item.latest.beta.toFixed(2)}, BTC rel return=${formatPct(item.latest.btcRelReturn)}, BTC vol=${formatPct(item.latest.btcVol)}, S&P vol=${formatPct(item.latest.sp500Vol)}`;
    }),
    '',
    '## Historical correlation ranges',
    ...WINDOWS.map((window) => {
      const item: any = report.windows[String(window)];
      return `- ${window}d: p10=${item.corrP10.toFixed(2)}, median=${item.corrMedian.toFixed(2)}, p90=${item.corrP90.toFixed(2)}, samples=${item.samples}`;
    }),
    '',
    '## Verdict',
    report.verdict,
    '',
  ];
  writeFileSync(mdPath, `${lines.join('\n')}\n`);

  console.log(`[Cross-market context] rows=${report.alignedTradingRows} latest=${report.latestDate}`);
  for (const window of WINDOWS) {
    const item: any = report.windows[String(window)];
    console.log(`[Cross-market context] ${window}d corr=${item.latest.corr.toFixed(2)} beta=${item.latest.beta.toFixed(2)} rel=${formatPct(item.latest.btcRelReturn)} corrHist=${item.corrP10.toFixed(2)}/${item.corrMedian.toFixed(2)}/${item.corrP90.toFixed(2)}`);
  }
  console.log(`[Cross-market context] verdict=${report.verdict.split(':')[0]}`);
  console.log(`[Cross-market context] wrote ${jsonPath}`);
  console.log(`[Cross-market context] wrote ${mdPath}`);
}

main().catch((error) => {
  console.error(`[Cross-market context] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
