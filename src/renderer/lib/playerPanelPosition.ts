/** Prefer the trigger's center, but keep wide panels within the player. */
export function panelLeft(center: number, width: number, left: number, right: number, margin = 8): number {
  return Math.max(left + margin, Math.min(center - width / 2, right - margin - width));
}
