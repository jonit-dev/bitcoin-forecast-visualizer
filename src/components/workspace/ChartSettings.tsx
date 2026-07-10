import { useEffect, useId, useRef, type RefObject } from 'react';

export interface OverlayControl { id: string; label: string; group: 'Price' | 'Forecast' | 'Bitcoin context'; checked: boolean; onChange(): void; description: string }
export function ChartSettings({ open, controls, onClose, triggerRef }: { open: boolean; controls: OverlayControl[]; onClose(): void; triggerRef: RefObject<HTMLButtonElement | null> }) {
  const titleId = useId(); const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); triggerRef.current?.focus(); return; }
      if (event.key === 'Tab') {
        const focusables = [...document.querySelectorAll<HTMLElement>('.chart-settings button, .chart-settings input')].filter((node) => !node.hasAttribute('disabled'));
        const current = focusables.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (current <= 0 ? focusables.length - 1 : current - 1) : (current === focusables.length - 1 ? 0 : current + 1);
        event.preventDefault(); focusables[next]?.focus();
      }
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [open, onClose, triggerRef]);
  if (!open) return null;
  const close = () => { onClose(); requestAnimationFrame(() => triggerRef.current?.focus()); };
  return <div className="chart-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="chart-settings" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header><h2 id={titleId}>Chart settings</h2><button ref={closeRef} type="button" aria-label="Close chart settings" onClick={close}>Close</button></header>
    {(['Price', 'Forecast', 'Bitcoin context'] as const).map((group) => controls.some((control) => control.group === group) && <fieldset key={group}><legend>{group}</legend>{controls.filter((control) => control.group === group).map((control) => <label key={control.id} title={control.description}><span><strong>{control.label}</strong><small>{control.description}</small></span><input type="checkbox" role="switch" checked={control.checked} onChange={control.onChange} /></label>)}</fieldset>)}
  </section></div>;
}
