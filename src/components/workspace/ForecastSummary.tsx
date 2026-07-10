export function ForecastSummary({ current, median, move, probability, lower, upper, horizonLabel }: { current: string; median: string; move: string; probability?: string; lower?: string; upper?: string; horizonLabel: string }) {
  return <section className="forecast-summary" aria-label="Forecast summary">
    <div><span>Current quote</span><strong>{current}</strong></div>
    <div><span>{horizonLabel} median</span><strong>{median}</strong></div>
    <div><span>Move / probability up</span><strong>{move}{probability ? ` · ${probability}` : ''}</strong></div>
    <div><span>Scenario range</span><strong>{lower && upper ? `${lower} – ${upper}` : '—'}</strong></div>
  </section>;
}
