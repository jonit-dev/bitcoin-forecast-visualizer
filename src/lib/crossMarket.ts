import type { OHLCVData } from './api';

export interface CrossMarketContext {
  latestDate: string;
  windowDays: number;
  correlation: number;
  beta: number;
  btcRelativeReturn: number;
  btcAnnualizedVol: number;
  sp500AnnualizedVol: number;
  regime: 'Risk-on linked' | 'Partly linked' | 'Crypto-specific' | 'Inverse stress';
  verdict: 'Promote as context';
  summary: string;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

function buildAlignedReturns(btcRows: OHLCVData[], sp500Rows: OHLCVData[]) {
  const btcByDate = new Map(btcRows.map((row) => [row.date, row]));
  const spByDate = new Map(sp500Rows.map((row) => [row.date, row]));
  const dates = [...btcByDate.keys()].filter((date) => spByDate.has(date)).sort();
  return dates.slice(1).flatMap((date, index) => {
    const previousDate = dates[index];
    const btcPrev = btcByDate.get(previousDate)!;
    const btc = btcByDate.get(date)!;
    const spPrev = spByDate.get(previousDate)!;
    const sp = spByDate.get(date)!;
    if (btcPrev.close <= 0 || btc.close <= 0 || spPrev.close <= 0 || sp.close <= 0) return [];
    return [{
      date,
      btcReturn: Math.log(btc.close / btcPrev.close),
      sp500Return: Math.log(sp.close / spPrev.close),
      btcClose: btc.close,
      sp500Close: sp.close,
    }];
  });
}

function classifyRegime(correlationValue: number, beta: number): CrossMarketContext['regime'] {
  if (correlationValue < -0.15) return 'Inverse stress';
  if (correlationValue >= 0.45 && beta >= 1.25) return 'Risk-on linked';
  if (correlationValue >= 0.20) return 'Partly linked';
  return 'Crypto-specific';
}

export function computeCrossMarketContext(
  btcRows: OHLCVData[],
  sp500Rows: OHLCVData[],
  windowDays = 90
): CrossMarketContext | null {
  const aligned = buildAlignedReturns(btcRows, sp500Rows);
  if (aligned.length <= windowDays + 1) return null;
  const latest = aligned[aligned.length - 1];
  const window = aligned.slice(-windowDays);
  const btc = window.map((row) => row.btcReturn);
  const sp = window.map((row) => row.sp500Return);
  const corr = correlation(btc, sp);
  const spSd = sampleSd(sp);
  const btcSd = sampleSd(btc);
  const beta = spSd > 0 ? corr * btcSd / spSd : 0;
  const first = aligned[aligned.length - windowDays - 1];
  const btcRelativeReturn = Math.log(latest.btcClose / first.btcClose) - Math.log(latest.sp500Close / first.sp500Close);
  const regime = classifyRegime(corr, beta);
  const summary = regime === 'Risk-on linked'
    ? 'BTC is currently behaving like high-beta risk exposure; equity/liquidity shocks matter.'
    : regime === 'Partly linked'
      ? 'BTC has a moderate equity link; use macro context but do not overfit it.'
      : regime === 'Inverse stress'
        ? 'BTC is moving against equities; treat this as stress/idiosyncratic behavior.'
        : 'BTC is mostly idiosyncratic versus equities in this window.';

  return {
    latestDate: latest.date,
    windowDays,
    correlation: corr,
    beta,
    btcRelativeReturn,
    btcAnnualizedVol: btcSd * Math.sqrt(252),
    sp500AnnualizedVol: spSd * Math.sqrt(252),
    regime,
    verdict: 'Promote as context',
    summary,
  };
}
