import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketBar } from '../workspace/MarketBar';
import { ForecastControls } from '../workspace/ForecastControls';

afterEach(cleanup);
const assets = [{ id: 'btc' as const, label: 'Bitcoin', shortLabel: 'BTC', ticker: 'BTC' }, { id: 'sp500' as const, label: 'S&P 500', shortLabel: 'S&P', ticker: 'VOO' }, { id: 'gold' as const, label: 'Gold', shortLabel: 'Gold', ticker: 'GLD' }];

describe('forecast workspace header', () => {
  it('navigates assets as a semantic tablist', () => {
    const onChange = vi.fn(); render(<MarketBar assets={assets} activeId="btc" onChange={onChange} quoteDate="2026-07-10" status="current" />);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    const btc = screen.getByRole('tab', { name: 'BTC' }); expect(btc.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(btc, { key: 'ArrowRight' }); expect(onChange).toHaveBeenCalledWith('sp500');
  });

  it('changes horizon and confidence without losing accessible names', () => {
    const horizon = vi.fn(); const confidence = vi.fn();
    render(<ForecastControls horizon={180} options={[{ value: 180, label: '6M' }, { value: 365, label: '1Y' }]} confidence={0.95} confidenceLabel="Interval band" trustCopy="Scenario range" busy={false} onHorizon={horizon} onConfidence={confidence} onRefresh={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '1Y' })); expect(horizon).toHaveBeenCalledWith(365);
    fireEvent.change(screen.getByRole('combobox', { name: 'Confidence interval' }), { target: { value: '0.9' } }); expect(confidence).toHaveBeenCalledWith(.9);
  });

  it('announces forecast recomputation', () => {
    render(<ForecastControls horizon={180} options={[]} confidence={0.95} confidenceLabel="Interval band" trustCopy="Scenario range" busy onHorizon={() => {}} onConfidence={() => {}} onRefresh={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('recomputing');
  });
});
