import type { MarketDataStatus as Status } from '../lib/api';

export function MarketDataStatus({ date, status }: { date: string; status: Status }) {
  const label = status === 'current' ? 'Current' : status === 'delayed' ? 'Delayed' : status === 'unavailable' ? 'Unavailable' : 'Bundled fallback';
  return <span className="market-data-status" data-status={status}><span aria-hidden="true">●</span> {label} · through {date}</span>;
}
