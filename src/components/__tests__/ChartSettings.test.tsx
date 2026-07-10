import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartSettings, type OverlayControl } from '../workspace/ChartSettings';
afterEach(cleanup);
const controls = (toggle = vi.fn()): OverlayControl[] => [{ id: 'path', label: 'Forecast path', group: 'Forecast', checked: true, onChange: toggle, description: 'Median path' }];
describe('Chart settings', () => {
  it('groups overlays and toggles the requested layer', () => { const toggle = vi.fn(); render(<ChartSettings open controls={controls(toggle)} onClose={() => {}} triggerRef={createRef()} />); const control = screen.getByRole('switch', { name: /Forecast path/ }); expect((control as HTMLInputElement).checked).toBe(true); fireEvent.click(control); expect(toggle).toHaveBeenCalledOnce(); });
  it('omits unsupported Bitcoin overlays for other assets', () => { render(<ChartSettings open controls={controls()} onClose={() => {}} triggerRef={createRef()} />); expect(screen.queryByRole('switch', { name: /MVRV/ })).toBeNull(); });
  it('closes with Escape and restores trigger focus', () => { const close = vi.fn(); const trigger = document.createElement('button'); document.body.append(trigger); const ref = { current: trigger }; render(<ChartSettings open controls={controls()} onClose={close} triggerRef={ref} />); fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(trigger); trigger.remove(); });
  it('traps Tab focus within the dialog', () => { render(<ChartSettings open controls={controls()} onClose={() => {}} triggerRef={createRef()} />); const close = screen.getByRole('button', { name: 'Close chart settings' }); close.focus(); fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(screen.getByRole('switch')).toBe(document.activeElement); });
});
