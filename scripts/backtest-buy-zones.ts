import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUY_ZONE_CONFIG, computeBuyZonePoints, computeBuyZoneSummary, type BuyZoneBacktestResult } from '../src/lib/buyZone';

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');

function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function fmtScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(3);
}

function renderBacktest(result: BuyZoneBacktestResult): string {
  const rows = result.events
    .map(event => `| ${event.date} | $${Math.round(event.close).toLocaleString()} | ${fmtScore(event.bottomScore)} | ${fmtPct(event.forwardReturn1y)} | ${fmtPct(event.forwardReturn2y)} | ${fmtPct(event.worstDrawdown180d)} |`)
    .join('\n');

  return `### ${result.label}\n\n` +
    `- cooldown: ${result.cooldownDays}d\n` +
    `- samples: ${result.sampleCount}\n` +
    `- 1y median / mean / win: ${fmtPct(result.medianReturn1y)} / ${fmtPct(result.meanReturn1y)} / ${fmtPct(result.winRate1y)}\n` +
    `- 2y median / mean / win: ${fmtPct(result.medianReturn2y)} / ${fmtPct(result.meanReturn2y)} / ${fmtPct(result.winRate2y)}\n` +
    `- median max gain 1y: ${fmtPct(result.medianMaxGain1y)}\n` +
    `- median worst drawdown next 180d: ${fmtPct(result.medianWorstDrawdown180d)}\n\n` +
    `| date | close | score | fwd 1y | fwd 2y | worst DD 180d |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: |\n` +
    `${rows || '| n/a | n/a | n/a | n/a | n/a | n/a |'}\n`;
}

function renderMarkdown(summary: ReturnType<typeof computeBuyZoneSummary>): string {
  const latest = summary.latest;
  const backtests = summary.backtests.map(renderBacktest).join('\n');
  const zones = summary.zones
    .map(zone => `| ${zone.startDate} | ${zone.endDate} | ${zone.days} | $${Math.round(zone.lowPrice).toLocaleString()} on ${zone.lowDate} | ${fmtScore(zone.maxScore)} on ${zone.maxScoreDate} | ${zone.maxConviction ? 'yes' : 'no'} |`)
    .join('\n');

  return `# BTC buy-zone backtest\n\n` +
    `Generated: ${summary.generatedAt}\n\n` +
    `## Pre-registered rule\n\n` +
    `Heavy Buy Zone begins at \`bottomScore >= ${BUY_ZONE_CONFIG.heavyThreshold}\`; Max Conviction begins at \`bottomScore >= ${BUY_ZONE_CONFIG.maxConvictionThreshold}\`.\n\n` +
    `The score is computed only from past-known percentile ranks: power-law residual cheapness, MVRV percentile, realized-price distance, and drawdown pain. Modern test period starts ${BUY_ZONE_CONFIG.modernStartDate}; each origin needs at least ${BUY_ZONE_CONFIG.minPriorSamples} prior observations. Events are de-duplicated by ${BUY_ZONE_CONFIG.defaultCooldownDays}d cooldown.\n\n` +
    `## Latest\n\n` +
    (latest ? `- date: ${latest.date}\n- close: $${Math.round(latest.close).toLocaleString()}\n- bottomScore: ${fmtScore(latest.bottomScore)}\n- heavy buy: ${latest.isHeavyBuy ? 'yes' : 'no'}\n- max conviction: ${latest.isMaxConviction ? 'yes' : 'no'}\n- residual percentile: ${fmtScore(latest.residualPctPast)}\n- MVRV percentile: ${fmtScore(latest.mvrvPercentile)}\n- realized-price-distance percentile: ${fmtScore(latest.realizedPctPast)}\n- drawdown pain percentile: ${fmtScore(latest.drawdownPainPctPast)}\n\n` : 'No latest point.\n\n') +
    `## Backtests\n\n${backtests}\n` +
    `## Historical heavy-buy zones\n\n` +
    `| start | end | days | low | max score | max conviction |\n` +
    `| --- | --- | ---: | --- | --- | --- |\n` +
    `${zones}\n\n` +
    `## Verdict\n\n` +
    `Status: **${summary.verdict}**. ${summary.caveat}\n`;
}

function main(): void {
  const points = computeBuyZonePoints();
  const summary = computeBuyZoneSummary();
  mkdirSync(REPORT_DIR, { recursive: true });

  const stamp = summary.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `buy-zone-backtest-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `buy-zone-backtest-${stamp}.md`);
  const runtimeSummaryPath = join(process.cwd(), 'src', 'data', 'buy-zone-summary.json');

  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(summary));
  writeFileSync(runtimeSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`[Buy-zone lab] points=${points.length} zones=${summary.zones.length}`);
  console.log(`[Buy-zone lab] latest=${summary.latest?.date} score=${fmtScore(summary.latest?.bottomScore)} heavy=${summary.latest?.isHeavyBuy ? 'yes' : 'no'}`);
  for (const backtest of summary.backtests) {
    console.log(`[Buy-zone lab] ${backtest.id}: n=${backtest.sampleCount} 1yMed=${fmtPct(backtest.medianReturn1y)} 2yMed=${fmtPct(backtest.medianReturn2y)} win1y=${fmtPct(backtest.winRate1y)}`);
  }
  console.log(`[Buy-zone lab] report=${markdownPath}`);
  console.log(`[Buy-zone lab] runtime=${runtimeSummaryPath}`);
}

main();
