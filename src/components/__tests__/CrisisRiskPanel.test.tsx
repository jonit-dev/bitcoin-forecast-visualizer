import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CrisisRiskPanel } from '../workspace/CrisisRiskPanel';

afterEach(cleanup);

describe('Crisis risk panel', () => {
  it('should show the shadow challenger zone and provenance', () => {
    render(<CrisisRiskPanel quoteDate="2026-08-15" />);

    expect(screen.getByRole('region', { name: 'Crisis risk context' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'NORMAL' })).toBeTruthy();
    expect(screen.getAllByText('3.51%').length).toBeGreaterThan(0);
    expect(screen.getByText(/shadow\/context-only/i)).toBeTruthy();
    expect(screen.getByText(/Probability levels are model-dependent/i)).toBeTruthy();
    expect(screen.getByText(/Stale imported score/i)).toBeTruthy();
    expect(screen.getAllByText(/2026-08-14/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026-08-15/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Cross 15% below the recent 252-session high/)).toBeTruthy();
  });

  it('should show threshold and history context without calling the price forecast', () => {
    render(<CrisisRiskPanel quoteDate="2026-08-14" />);

    expect(screen.getByText(/WATCH 10\.69%/)).toBeTruthy();
    expect(screen.getByText(/HIGH 23\.94%/)).toBeTruthy();
    expect(screen.getByText(/1,025 observations/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /Imported weekly challenger deployment probability/ })).toBeTruthy();
    expect(screen.queryByText(/forecast override/i)).toBeNull();
    expect(screen.getByRole('table', { name: 'Locked 2016-2025 challenger comparison' })).toBeTruthy();
    expect(screen.getByText(/every reported interval crosses zero/i)).toBeTruthy();
  });

  it('should expose an accessible history table fallback', () => {
    render(<CrisisRiskPanel quoteDate="2026-08-14" />);

    fireEvent.click(screen.getByText(/Accessible data table/));
    expect(screen.getByRole('table', { name: 'Imported weekly crisis-risk history' })).toBeTruthy();
    expect(screen.getAllByText('2000-01-07').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2025-12-26').length).toBeGreaterThan(0);
  });
});
