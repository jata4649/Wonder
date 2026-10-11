// 一様グリッドによる近傍検索（毎ティック再構築）。
import { WORLD_H, WORLD_W } from '../config/map';
import type { Mob } from './units/types';

const CELL = 128;
const COLS = Math.ceil(WORLD_W / CELL);
const ROWS = Math.ceil(WORLD_H / CELL);

export class SpatialGrid<T extends Mob = Mob> {
  private cells: T[][] = Array.from({ length: COLS * ROWS }, () => []);

  rebuild(items: Iterable<T>) {
    for (const c of this.cells) c.length = 0;
    for (const it of items) {
      if (!it.alive) continue;
      const cx = Math.max(0, Math.min(COLS - 1, Math.floor(it.x / CELL)));
      const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(it.y / CELL)));
      this.cells[cy * COLS + cx].push(it);
    }
  }

  /** 円 (x,y,r) と（各ユニットの半径込みで）重なる候補を列挙。 */
  query(x: number, y: number, r: number, cb: (it: T) => void) {
    const pad = r + 40;
    const x0 = Math.max(0, Math.floor((x - pad) / CELL));
    const x1 = Math.min(COLS - 1, Math.floor((x + pad) / CELL));
    const y0 = Math.max(0, Math.floor((y - pad) / CELL));
    const y1 = Math.min(ROWS - 1, Math.floor((y + pad) / CELL));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * COLS + cx];
        for (let i = 0; i < cell.length; i++) {
          const it = cell[i];
          const dx = it.x - x;
          const dy = it.y - y;
          const rr = r + it.r;
          if (dx * dx + dy * dy <= rr * rr) cb(it);
        }
      }
    }
  }

  collect(x: number, y: number, r: number): T[] {
    const out: T[] = [];
    this.query(x, y, r, (it) => out.push(it));
    return out;
  }
}
