import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
export type EvidenceId = 'overview' | 'model-risk' | 'data-market';
const ITEMS: Array<{ id: EvidenceId; label: string }> = [{ id: 'overview', label: 'Overview' }, { id: 'model-risk', label: 'Model & risk' }, { id: 'data-market', label: 'Data & market' }];

function useMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => { if (typeof window.matchMedia !== 'function') return; const query = window.matchMedia('(max-width: 767px)'); const update = () => setMobile(query.matches); update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return mobile;
}

export function EvidencePanel({ panels }: { panels: Record<EvidenceId, ReactNode> }) {
  const [active, setActive] = useState<EvidenceId>('overview'); const refs = useRef<Array<HTMLButtonElement | null>>([]); const mobile = useMobile();
  const keydown = (event: KeyboardEvent, index: number) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? ITEMS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ITEMS.length) % ITEMS.length; setActive(ITEMS[next].id); refs.current[next]?.focus(); };
  return <section className="evidence-panel" aria-labelledby="evidence-heading"><header><div><p className="eyebrow">Supporting evidence</p><h2 id="evidence-heading">Evidence</h2></div>{!mobile && <div role="tablist" aria-label="Evidence category">{ITEMS.map((item, index) => <button key={item.id} id={`evidence-tab-${item.id}`} ref={(node) => { refs.current[index] = node; }} role="tab" aria-selected={active === item.id} aria-controls={`evidence-${item.id}`} tabIndex={active === item.id ? 0 : -1} onClick={() => setActive(item.id)} onKeyDown={(event) => keydown(event, index)}>{item.label}</button>)}</div>}</header>
    {mobile ? <div className="evidence-accordions">{ITEMS.map((item) => <section key={item.id}><h3><button type="button" aria-expanded={active === item.id} aria-controls={`evidence-${item.id}`} onClick={() => setActive(active === item.id ? 'overview' : item.id)}>{item.label}</button></h3><div id={`evidence-${item.id}`} hidden={active !== item.id} className="evidence-content">{panels[item.id]}</div></section>)}</div> : ITEMS.map((item) => <div key={item.id} id={`evidence-${item.id}`} role="tabpanel" aria-labelledby={`evidence-tab-${item.id}`} hidden={active !== item.id} className="evidence-content">{panels[item.id]}</div>)}
  </section>;
}
