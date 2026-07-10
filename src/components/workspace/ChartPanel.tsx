import { type ReactNode, type RefObject } from 'react';
import { Play, Square } from 'lucide-react';

export function ChartPanel({ title, subtitle, range, onRange, isPlaying, busy, onPlayToggle, settingsTriggerRef, settingsOpen, onOpenSettings, children }: { title: string; subtitle: string; range: string; onRange(value: string): void; isPlaying: boolean; busy: boolean; onPlayToggle(): void; settingsTriggerRef: RefObject<HTMLButtonElement | null>; settingsOpen: boolean; onOpenSettings(): void; children: ReactNode }) {
  return <section className="chart-panel" aria-label="Forecast chart">
    <header className="chart-panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div><div className="chart-panel-tools"><div className="range-controls" aria-label="Chart range">{['1M', '3M', '6M', '1Y', 'ALL'].map((value) => <button key={value} type="button" aria-pressed={range === value} onClick={() => onRange(value)}>{value}</button>)}</div><button ref={settingsTriggerRef} type="button" className="chart-settings-trigger" aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={onOpenSettings}>Chart settings</button><button type="button" className={isPlaying ? 'chart-play stop' : 'chart-play'} onClick={onPlayToggle} disabled={busy}>{isPlaying ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}{isPlaying ? 'Stop' : 'Play'}</button></div></header>
    <div className="chart-panel-body" aria-busy={busy}>{children}</div>
  </section>;
}
