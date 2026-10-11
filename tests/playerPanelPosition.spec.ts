import { describe, expect, it } from 'vitest';
import { panelLeft } from '../src/renderer/lib/playerPanelPosition';

describe('player panel anchoring', () => {
  it('centers above the hovered icon when there is room', () => {
    expect(panelLeft(500, 340, 100, 1100)).toBe(330);
  });
  it('keeps a wide danmaku panel inside the right edge', () => {
    expect(panelLeft(1000, 438, 100, 1100)).toBe(654);
  });
  it('keeps a subtitle panel inside the left edge', () => {
    expect(panelLeft(140, 340, 100, 1100)).toBe(108);
  });
  it('fits a panel resized to a narrow player', () => {
    expect(panelLeft(380, 304, 100, 420)).toBe(108);
  });
});
