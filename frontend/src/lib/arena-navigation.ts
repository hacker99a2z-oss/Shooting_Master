import PF from "pathfinding";
import type { Point } from "./game-controls";

export type Obstacle = { x: number; y: number; w: number; h: number };
const CELL = 12;
export function createArenaNavigation(width: number, height: number, covers: Obstacle[], radius = 12) {
  const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);
  const base = new PF.Grid(cols, rows);
  const blocked = (x: number, y: number) => x < radius || y < radius || x > width - radius || y > height - radius || covers.some(c => x + radius > c.x && x - radius < c.x + c.w && y + radius > c.y + c.h * 0.35 && y - radius < c.y + c.h + 3);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) base.setWalkableAt(x, y, !blocked(x * CELL + CELL / 2, y * CELL + CELL / 2));
  const nearest = (point: Point): [number, number] | null => {
    const cx = Math.max(0, Math.min(cols - 1, Math.floor(point.x / CELL))), cy = Math.max(0, Math.min(rows - 1, Math.floor(point.y / CELL)));
    for (let r = 0; r < 12; r++) for (let y = Math.max(0, cy - r); y <= Math.min(rows - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(cols - 1, cx + r); x++) if (base.isWalkableAt(x, y)) return [x, y];
    return null;
  };
  const clear = (from: Point, to: Point) => {
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4);
    for (let i = 0; i <= steps; i++) { const t = steps ? i / steps : 0; if (blocked(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false; }
    return true;
  };
  return {
    blocked, clear,
    route(from: Point, to: Point): Point[] {
      if (clear(from, to)) return [to];
      const start = nearest(from), end = nearest(to);
      if (!start || !end) return [];
      const finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
      return finder.findPath(start[0], start[1], end[0], end[1], base.clone()).map(([x, y]) => ({ x: (x ?? 0) * CELL + CELL / 2, y: (y ?? 0) * CELL + CELL / 2 }));
    },
  };
}