import { getCurrentCrisisRisk, type CrisisRiskAssessment } from '../../lib/sp500CrisisModel';

interface CrisisRiskPanelProps {
  quoteDate: string;
  assessment?: CrisisRiskAssessment;
}

const metricRows = [
  { key: 'average_precision_gain' as const, label: 'Average precision', format: (value: number) => value.toFixed(4) },
  { key: 'roc_auc_gain' as const, label: 'ROC AUC', format: (value: number) => value.toFixed(4) },
  { key: 'brier_improvement' as const, label: 'Brier score improvement', format: (value: number) => value.toFixed(4) },
  { key: 'log_loss_improvement' as const, label: 'Log-loss improvement', format: (value: number) => value.toFixed(4) },
];

function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatPercent(value)}`;
}

function formatInterval(interval: [number, number]): string {
  return `[${formatSignedPercent(interval[0])}, ${formatSignedPercent(interval[1])}]`;
}

export function CrisisRiskPanel({ quoteDate, assessment: provided }: CrisisRiskPanelProps) {
  const assessment = provided ?? getCurrentCrisisRisk(quoteDate);
  const { snapshot, score } = assessment;
  const { deploymentThresholds } = score;
  const history = snapshot.oosHistory;
  const holdout = snapshot.holdout;
  const uncertainty = holdout.uncertainty;
  const firstHistoryDate = history[0].date;
  const lastHistoryDate = history.at(-1)!.date;

  return (
    <section className="crisis-risk-panel" aria-labelledby="crisis-risk-title">
      <header className="crisis-risk-header">
        <div>
          <p className="eyebrow">Imported model context</p>
          <h2 id="crisis-risk-title">Crisis risk context</h2>
        </div>
        <span className="crisis-mode-badge">SHADOW MODE · NOT PROMOTED</span>
      </header>

      <div className="crisis-risk-grid">
        <article className="crisis-current-card" aria-labelledby="crisis-current-title">
          <p className="eyebrow">Score provenance</p>
          <h3 id="crisis-current-title">How the {formatPercent(score.challengerDeploymentProbability)} score was produced</h3>
          <dl className="crisis-score-list">
            <div><dt>Base raw probability (external classifier)</dt><dd>{formatPercent(score.baseRawProbability)}</dd></div>
            <div><dt>Incumbent mapper output</dt><dd>{formatPercent(score.incumbentProbability)}</dd></div>
            <div><dt>Challenger evaluation probability</dt><dd>{formatPercent(score.challengerEvaluationProbability)}</dd></div>
            <div><dt>Challenger deployment probability</dt><dd>{formatPercent(score.challengerDeploymentProbability)}</dd></div>
            <div><dt>Score as of</dt><dd><time dateTime={score.asOfDate}>{score.asOfDate}</time></dd></div>
            <div><dt>Active VOO quote through</dt><dd><time dateTime={assessment.quoteDate}>{assessment.quoteDate}</time></dd></div>
          </dl>
          <p className="crisis-context-copy">Imported challenger output; shadow/context-only. The base raw score is shown separately and is not recomputed from VOO data.</p>
          <p className="crisis-context-copy">{score.note}</p>
          {assessment.isStale && <p className="crisis-stale-warning" role="alert"><strong>Stale imported score.</strong> The score is as of {score.asOfDate}, earlier than the active VOO quote through {assessment.quoteDate}. No score is silently extrapolated or refreshed in this surface.</p>}
        </article>

        <article className="crisis-threshold-card" aria-labelledby="crisis-threshold-title">
          <p className="eyebrow">Frozen deployment thresholds</p>
          <h3 id="crisis-threshold-title">Challenger v2 zones</h3>
          <dl className="crisis-threshold-list">
            <div><dt><span className="crisis-zone-dot crisis-zone-dot-normal" />NORMAL</dt><dd>&lt; {formatPercent(deploymentThresholds.watch)}</dd></div>
            <div><dt><span className="crisis-zone-dot crisis-zone-dot-watch" />WATCH</dt><dd>{formatPercent(deploymentThresholds.watch)}–{formatPercent(deploymentThresholds.high)}</dd></div>
            <div><dt><span className="crisis-zone-dot crisis-zone-dot-high" />HIGH</dt><dd>≥ {formatPercent(deploymentThresholds.high)}</dd></div>
          </dl>
          <dl className="crisis-meta-list">
            <div><dt>Model snapshot date</dt><dd><time dateTime={snapshot.source.snapshotDate}>{snapshot.source.snapshotDate}</time></dd></div>
            <div><dt>Target</dt><dd>{snapshot.targetDefinition}</dd></div>
            <div><dt>Current drawdown</dt><dd>{formatSignedPercent(score.currentDrawdown)}</dd></div>
            <div><dt>VIX at score date</dt><dd>{score.vix.toFixed(2)}</dd></div>
          </dl>
        </article>
      </div>

      <section className="crisis-history" aria-labelledby="crisis-history-title">
        <div className="crisis-section-heading">
          <div>
            <p className="eyebrow">Out-of-sample history</p>
            <h3 id="crisis-history-title">Weekly challenger-risk observations</h3>
          </div>
          <p>{history.length.toLocaleString()} observations · {firstHistoryDate} to {lastHistoryDate}</p>
        </div>
        <p className="crisis-context-copy">Same series as the chart above, as raw numbers. Probabilities are imported, not recomputed, and do not change the shared VOO price path.</p>
        <details className="crisis-history-fallback">
          <summary>Accessible data table ({history.length.toLocaleString()} weekly observations)</summary>
          <div className="crisis-table-scroll">
            <table aria-label="Imported weekly crisis-risk history">
              <caption>OOS weekly crisis-risk history. Probabilities are imported, not recomputed.</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Raw base score</th><th scope="col">Incumbent</th><th scope="col">Challenger v2</th><th scope="col">Target</th></tr></thead>
              <tbody>{history.map((point) => <tr key={point.date}><th scope="row">{point.date}</th><td>{formatPercent(point.rawProbability)}</td><td>{formatPercent(point.incumbentProbability)}</td><td>{formatPercent(point.challengerDeploymentProbability)}</td><td>{point.target ? 'Crisis' : 'No crisis'}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="crisis-holdout" aria-labelledby="crisis-holdout-title">
        <div className="crisis-section-heading">
          <div>
            <p className="eyebrow">Locked evaluation</p>
            <h3 id="crisis-holdout-title">Locked {holdout.period} comparison</h3>
          </div>
          <p>{holdout.challenger.rows} rows · {holdout.challenger.positives} positives</p>
        </div>
        <div className="crisis-table-scroll">
          <table aria-label={`Locked ${holdout.period} challenger comparison`}>
            <caption>Incumbent versus challenger v2 on the locked holdout.</caption>
            <thead><tr><th scope="col">Metric</th><th scope="col">Incumbent</th><th scope="col">Challenger v2</th><th scope="col">Change</th><th scope="col">95% interval</th></tr></thead>
            <tbody>{metricRows.map((metric) => {
              const metricKey = metric.key === 'brier_improvement' ? 'brier_score' : metric.key.replace('_gain', '').replace('_improvement', '');
              const incumbent = holdout.incumbent[metricKey as keyof typeof holdout.incumbent] as number;
              const challenger = holdout.challenger[metricKey as keyof typeof holdout.challenger] as number;
              const change = holdout.improvement[metric.key];
              return <tr key={metric.key}><th scope="row">{metric.label}</th><td>{metric.format(incumbent)}</td><td>{metric.format(challenger)}</td><td>{formatSignedPercent(change)}</td><td>{formatInterval(uncertainty[metric.key].ci_95)}</td></tr>;
            })}</tbody>
          </table>
        </div>
        <p className="crisis-uncertainty-note"><strong>Uncertainty caveat:</strong> 95% calendar-year block-bootstrap intervals are wide and every reported interval crosses zero. This is a promising challenger, not statistical proof of superiority; v2 remains in shadow mode pending a genuinely unseen period or stronger validation.</p>
      </section>

      <section className="crisis-limitations" aria-labelledby="crisis-limitations-title">
        <h3 id="crisis-limitations-title">Known limitations</h3>
        <ol>{snapshot.knownLimitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ol>
        <p>Source: {snapshot.source.archive}; browser snapshot dated {snapshot.source.snapshotDate}. The Python/joblib model is not shipped or executed in the browser.</p>
      </section>
    </section>
  );
}
