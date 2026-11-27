import { describe, expect, it, vi } from 'vitest';
import { HalvingCyclePrimitive, HALVING_DATES } from '../chart/primitives';

describe('HalvingCyclePrimitive', () => {
  it('hides its pane views when toggled off and redraws', () => {
    const requestUpdate = vi.fn();
    const primitive = new HalvingCyclePrimitive(HALVING_DATES);
    primitive.attached({ chart: {}, requestUpdate });
    expect(primitive.paneViews()).toHaveLength(1);
    primitive.setVisible(false);
    expect(primitive.paneViews()).toHaveLength(0);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    primitive.setVisible(true);
    expect(primitive.paneViews()).toHaveLength(1);
  });
});
