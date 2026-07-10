export interface HorizonOption { value: number; label: string }
export function ForecastControls({ horizon, options, confidence, confidenceLabel, trustCopy, busy, onHorizon, onConfidence, onRefresh }: { horizon: number; options: HorizonOption[]; confidence: number; confidenceLabel: string; trustCopy: string; busy: boolean; onHorizon(value: number): void; onConfidence(value: number): void; onRefresh(): void }) {
  return <section className="forecast-controls" aria-label="Forecast controls">
    <fieldset><legend>Forecast horizon</legend><div className="horizon-options">{options.map((option) => <button type="button" key={option.value} aria-pressed={horizon === option.value} onClick={() => onHorizon(option.value)}>{option.label}</button>)}</div></fieldset>
    <label className="confidence-control">{confidenceLabel}<select aria-label="Confidence interval" value={confidence} onChange={(event) => onConfidence(Number(event.target.value))}><option value={0.95}>95%</option><option value={0.9}>90%</option><option value={0.8}>80%</option></select></label>
    <button type="button" className="refresh-forecast" disabled={busy} aria-busy={busy} onClick={onRefresh}>{busy ? 'Computing…' : 'Refresh forecast'}</button>
    <p className="forecast-trust-copy">{trustCopy}</p>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{busy ? 'Forecast recomputing' : 'Forecast ready'}</div>
  </section>;
}
