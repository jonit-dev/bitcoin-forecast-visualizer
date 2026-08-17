import type { CrisisRiskAssessment } from '../../lib/sp500CrisisModel';

function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function CrisisSummary({ assessment }: { assessment: CrisisRiskAssessment }) {
  const { score, zone } = assessment;
  return (
    <section className={`forecast-summary crisis-summary crisis-zone-${zone.toLowerCase()}`} aria-label="Crisis summary">
      <div>
        <span>Operational zone</span>
        <strong aria-live="polite">{zone}</strong>
      </div>
      <div>
        <span>Challenger v2 crisis probability</span>
        <strong>{formatPercent(score.challengerDeploymentProbability)}</strong>
      </div>
      <div>
        <span>Incumbent probability</span>
        <strong>{formatPercent(score.incumbentProbability)}</strong>
      </div>
      <div>
        <span>Score as of · VOO quote</span>
        <strong>{score.asOfDate} · {assessment.quoteDate}</strong>
      </div>
    </section>
  );
}
