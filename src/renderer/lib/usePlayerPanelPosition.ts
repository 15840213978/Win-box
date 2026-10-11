import { useLayoutEffect, useRef, type RefObject } from 'react';
import { panelLeft } from './playerPanelPosition';

export function usePlayerPanelPosition(open: boolean, player: RefObject<HTMLDivElement | null>) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = host.current;
    const root = player.current;
    const anchor = panel?.parentElement;
    if (!open || !panel || !root || !anchor) return;
    const update = () => {
      const bounds = root.getBoundingClientRect();
      const trigger = anchor.getBoundingClientRect();
      panel.style.maxWidth = `${Math.max(0, bounds.width - 16)}px`;
      const left = panelLeft(trigger.left + trigger.width / 2, panel.getBoundingClientRect().width, bounds.left, bounds.right);
      panel.style.left = `${left - trigger.left}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    observer.observe(panel);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [open, player]);
  return host;
}
