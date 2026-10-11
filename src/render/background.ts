// 静的な盤面（レーン・森・崖）をオフスクリーンに描いてキャッシュする。
import {
  FOREST_STRIPS,
  FOREST_Y0,
  FOREST_Y1,
  LANE_WIDTH,
  LANE_X,
  PLAY_X0,
  PLAY_X1,
  PLAY_Y0,
  PLAY_Y1,
  WORLD_H,
  WORLD_W,
  type WallDef,
} from '../config/map';
import { teamTint } from '../config/settings';
import { makeRng } from '../sim/geom';

export const BG_SCALE = 0.5;
/** 背景タイルがあるときは細部が見えるよう解像度を上げる。 */
export const BG_SCALE_TILE = 0.75;

/**
 * map_tile_v.png（683×1024・シームレス）には道が3本、約228px間隔で縦に走っている。
 * レーン間隔600に合わせて k=600/227.7 倍で敷き、道の中心をレーン x に揃える（SPEC 7.1：縦レーンは _v を縦に敷く）。
 */
const TILE_ROAD_PERIOD = 683 / 3;
const TILE_ROAD0 = 113; // タイル内の最初の道の中心 x
const TILE_K = (LANE_X[1] - LANE_X[0]) / TILE_ROAD_PERIOD;
const TILE_OX = LANE_X[0] - TILE_ROAD0 * TILE_K;

export function renderBackground(walls: WallDef[], tile?: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const scale = tile ? BG_SCALE_TILE : BG_SCALE;
  const c = document.createElement('canvas');
  c.width = Math.ceil(WORLD_W * scale);
  c.height = Math.ceil(WORLD_H * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);

  // 地面
  g.fillStyle = '#3b5a3a';
  g.fillRect(0, 0, WORLD_W, WORLD_H);
  if (tile) {
    const pat = g.createPattern(tile, 'repeat');
    if (pat) {
      g.save();
      g.translate(TILE_OX, 0);
      g.scale(TILE_K, TILE_K);
      g.fillStyle = pat;
      g.fillRect(-TILE_OX / TILE_K, 0, WORLD_W / TILE_K + tile.width, WORLD_H / TILE_K + tile.height);
      g.restore();
    }
  }
  // 陣地の色味（下=自軍, 上=敵軍）
  const grad = g.createLinearGradient(0, 0, 0, WORLD_H);
  grad.addColorStop(0, teamTint(1, 0.18));
  grad.addColorStop(0.42, 'rgba(0,0,0,0)');
  grad.addColorStop(0.58, 'rgba(0,0,0,0)');
  grad.addColorStop(1, teamTint(0, 0.18));
  g.fillStyle = grad;
  g.fillRect(PLAY_X0, PLAY_Y0, PLAY_X1 - PLAY_X0, PLAY_Y1 - PLAY_Y0);

  const rng = makeRng(7);
  // 森
  for (const s of FOREST_STRIPS) {
    if (tile) {
      // タイルの森を活かし、少し暗くして「見通しの悪い森」と分かるように
      g.fillStyle = 'rgba(8,28,14,0.38)';
      g.fillRect(s.x0, FOREST_Y0, s.x1 - s.x0, FOREST_Y1 - FOREST_Y0);
      continue;
    }
    g.fillStyle = '#1f3a24';
    g.fillRect(s.x0, FOREST_Y0, s.x1 - s.x0, FOREST_Y1 - FOREST_Y0);
    for (let i = 0; i < 220; i++) {
      const x = rng.range(s.x0 + 10, s.x1 - 10);
      const y = rng.range(FOREST_Y0 + 10, FOREST_Y1 - 10);
      g.fillStyle = rng.next() < 0.5 ? 'rgba(20,48,26,0.9)' : 'rgba(34,72,40,0.8)';
      g.beginPath();
      g.arc(x, y, rng.range(10, 26), 0, Math.PI * 2);
      g.fill();
    }
  }

  // レーン（縦の道）
  for (const lx of LANE_X) {
    const x0 = lx - LANE_WIDTH / 2;
    if (tile) {
      // タイルの道（幅≈190）をレーン幅260まで薄く広げる
      g.fillStyle = 'rgba(196,176,132,0.42)';
      g.fillRect(x0, PLAY_Y0, LANE_WIDTH, PLAY_Y1 - PLAY_Y0);
      continue;
    }
    g.fillStyle = '#9b8a62';
    g.fillRect(x0, PLAY_Y0, LANE_WIDTH, PLAY_Y1 - PLAY_Y0);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(x0 + 18, PLAY_Y0, LANE_WIDTH - 36, PLAY_Y1 - PLAY_Y0);
    // 石畳の目地
    g.strokeStyle = 'rgba(60,45,25,0.25)';
    g.lineWidth = 3;
    for (let y = PLAY_Y0; y < PLAY_Y1; y += 60) {
      g.beginPath();
      g.moveTo(x0 + 10, y);
      g.lineTo(x0 + LANE_WIDTH - 10, y);
      g.stroke();
    }
  }
  // 城前の広場
  for (const [y0, y1] of [
    [PLAY_Y0, 450],
    [3150, PLAY_Y1],
  ]) {
    g.fillStyle = '#9b8a62';
    g.fillRect(PLAY_X0 + 40, y0, PLAY_X1 - PLAY_X0 - 80, y1 - y0);
  }
  // 中央線
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.setLineDash([30, 24]);
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(PLAY_X0, WORLD_H / 2);
  g.lineTo(PLAY_X1, WORLD_H / 2);
  g.stroke();
  g.setLineDash([]);

  // 壁
  for (const w of walls) {
    if (w.door) continue; // 扉は動的に描く
    if (w.kind === 'cliff') {
      g.fillStyle = '#20232b';
      g.fillRect(w.x, w.y, w.w, w.h);
      g.fillStyle = 'rgba(255,255,255,0.03)';
      for (let i = 0; i < (w.w * w.h) / 9000; i++) {
        g.beginPath();
        g.arc(rng.range(w.x, w.x + w.w), rng.range(w.y, w.y + w.h), rng.range(8, 30), 0, Math.PI * 2);
        g.fill();
      }
    } else if (w.kind === 'forestEdge') {
      g.fillStyle = '#122416';
      g.fillRect(w.x, w.y, w.w, w.h);
      g.fillStyle = '#2d5a33';
      for (let y = w.y + 12; y < w.y + w.h; y += 26) {
        g.beginPath();
        g.arc(w.x + w.w / 2, y, 17, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      g.fillStyle = '#5b5a55';
      g.beginPath();
      g.roundRect(w.x, w.y, w.w, w.h, 18);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.roundRect(w.x + 8, w.y + 6, w.w - 16, w.h / 3, 10);
      g.fill();
    }
  }
  // 外周の縁取り
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 8;
  g.strokeRect(PLAY_X0, PLAY_Y0, PLAY_X1 - PLAY_X0, PLAY_Y1 - PLAY_Y0);
  return c;
}
