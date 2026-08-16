import { useRef, type KeyboardEvent } from 'react';
import type { MarketAssetId, MarketDataStatus } from '../../lib/api';

export interface MarketBarAsset { id: MarketAssetId; label: string; shortLabel: string; ticker: string }
export function MarketBar({ assets, activeId, onChange, quoteDate, status }: { assets: MarketBarAsset[]; activeId: MarketAssetId; onChange(id: MarketAssetId): void; quoteDate: string; status: MarketDataStatus }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? assets.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + assets.length) % assets.length;
    onChange(assets[next].id); refs.current[next]?.focus();
  };
  const active = assets.find((asset) => asset.id === activeId)!;
  const statusLabel = status === 'current' ? 'Current' : status === 'delayed' ? 'Delayed' : status === 'unavailable' ? 'Unavailable' : 'Bundled fallback';
  return <section className="market-bar" aria-label="Market selection">
    <div className="asset-tabs" role="tablist" aria-label="Forecast asset">
      {assets.map((asset, index) => <button key={asset.id} ref={(node) => { refs.current[index] = node; }} role="tab" id={`asset-tab-${asset.id}`} aria-selected={activeId === asset.id} aria-controls="forecast-workspace" tabIndex={activeId === asset.id ? 0 : -1} onClick={() => onChange(asset.id)} onKeyDown={(event) => onKeyDown(event, index)}>{asset.shortLabel}</button>)}
    </div>
    <div className="market-identity"><strong>{active.label}</strong><span>{active.ticker}</span></div>
    <p className={`quote-freshness status-${status}`}><span aria-hidden="true">●</span> {statusLabel} · quote through <time dateTime={quoteDate}>{quoteDate}</time></p>
  </section>;
}
