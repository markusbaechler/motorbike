// Screen-space label collision: decide which map chips fit without
// overlapping each other or fixed obstacles (e.g. waypoint markers).

export interface Box {
  x: number; // left, px
  y: number; // top, px
  w: number;
  h: number;
}

const GAP = 2; // px breathing room between chips

const hit = (a: Box, b: Box) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * Greedy placement in priority order (lower number first, ties keep input
 * order). Returns a visibility flag per item, in input order.
 */
export function declutter(items: { box: Box; priority: number }[], obstacles: Box[]): boolean[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].priority - items[b].priority || a - b);
  const placed: Box[] = [];
  const visible = new Array<boolean>(items.length).fill(false);
  for (const i of order) {
    const b = items[i].box;
    if (obstacles.some((o) => hit(b, o)) || placed.some((p) => hit(b, p))) continue;
    placed.push(b);
    visible[i] = true;
  }
  return visible;
}
