import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EvidencePanel } from '../workspace/EvidencePanel';
afterEach(cleanup);
const panels = { overview: <p>Overview content</p>, 'model-risk': <p>Context only · disabled</p>, 'data-market': <p>Data content</p> };
describe('Evidence panel', () => {
  it('shows only the selected evidence category', () => { render(<EvidencePanel panels={panels} />); expect((screen.getByText('Overview content').closest('[role=tabpanel]') as HTMLElement)?.hidden).toBe(false); fireEvent.click(screen.getByRole('tab', { name: 'Model & risk' })); expect((screen.getByText('Overview content').closest('[role=tabpanel]') as HTMLElement)?.hidden).toBe(true); });
  it('preserves context-only and disabled signal labels', () => { render(<EvidencePanel panels={panels} />); fireEvent.click(screen.getByRole('tab', { name: 'Model & risk' })); expect(screen.getByText(/Context only · disabled/)).toBeTruthy(); });
  it('operates disclosure with keyboard', () => { render(<EvidencePanel panels={panels} />); const overview = screen.getByRole('tab', { name: 'Overview' }); fireEvent.keyDown(overview, { key: 'ArrowRight' }); expect(screen.getByRole('tab', { name: 'Model & risk' }).getAttribute('aria-selected')).toBe('true'); });
});
