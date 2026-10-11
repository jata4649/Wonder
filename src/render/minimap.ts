// ミニマップ（右上）。タップで拡大／もう一度タップで戻す。
// 敵は「味方の視界（キャスト・兵士・拠点）」に入っていて、かつ森に隠れていないものだけ表示。
import { FOREST_STRIPS, FOREST_Y0, FOREST_Y1, LANE_WIDTH, LANE_X, PLAY_X0, PLAY_X1, PLAY_Y0, PLAY_Y1 } from '../config/map';
import { teamColor } from '../config/settings';
import type { Team } from '../config/types';
import type { Mob } from '../sim/units/types';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import { safeTop, topBarHeight } from './hud';
import { orient } from '../input/orientation';

const PING_ICON: Record<string, string> = { gather: '集', retreat: '退', caution: '!', enemy: '敵' };

export class Minimap {
  expanded = false;
  rect = { x: 0, y: 0, w: 0, h: 0 };
  private cache?: HTMLCanvasElement;
  private cacheKey = '';
  private age = 99;

  /** 10Hz で再描画し、毎フレームはキャッシュを貼るだけ（60fps 対策）。 */
  drawCached(ctx: CanvasRenderingContext2D, world: World, team: Team, camera: Camera, playerId: number, dpr: number, dt: number) {
    this.layout(camera.viewW, camera.viewH);
    const key = `${this.expanded}:${orient.land}:${camera.viewW}x${camera.viewH}:${dpr}`;
    this.age += dt;
    if (!this.cache || key !== this.cacheKey || this.age >= 0.1) {
      this.age = 0;
      this.cacheKey = key;
      if (!this.cache) this.cache = document.createElement('canvas');
      const c = this.cache;
      c.width = Math.ceil(camera.viewW * dpr);
      c.height = Math.ceil(camera.viewH * dpr);
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, camera.viewW, camera.viewH);
      this.draw(g, world, team, camera, playerId);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.expanded) {
      ctx.drawImage(this.cache, 0, 0);
    } else {
      const r = this.rect;
      const pad = 2;
      const sx = Math.max(0, (r.x - pad) * dpr);
      const sy = Math.max(0, (r.y - pad) * dpr);
      const sw = (r.w + pad * 2) * dpr;
      const sh = (r.h + pad * 2) * dpr;
      ctx.drawImage(this.cache, sx, sy, sw, sh, sx, sy, sw, sh);
    }
    ctx.restore();
  }

  layout(viewW: number, viewH: number) {
    // 縦画面：縦長、横画面：横長（ワールドを90°回転した写像。SPEC 1.3(d)）
    const land = orient.land;
    const mapW = land ? PLAY_Y1 - PLAY_Y0 : PLAY_X1 - PLAY_X0;
    const mapH = land ? PLAY_X1 - PLAY_X0 : PLAY_Y1 - PLAY_Y0;
    const top = topBarHeight(viewH) + 6 + safeTop();
    if (this.expanded) {
      const maxW = viewW - 40;
      const maxH = viewH * 0.78;
      const k = Math.min(maxW / mapW, maxH / mapH);
      const w = mapW * k;
      const h = mapH * k;
      this.rect = { x: (viewW - w) / 2, y: (viewH - h) / 2, w, h };
    } else if (land) {
      const w = Math.min(176, viewW * 0.2);
      const h = (w * mapH) / mapW;
      this.rect = { x: viewW - w - 8, y: top, w, h };
    } else {
      const w = Math.min(100, viewW * 0.26);
      const h = (w * mapH) / mapW;
      this.rect = { x: viewW - w - 8, y: top, w, h };
    }
  }

  hit(sx: number, sy: number) {
    const r = this.rect;
    return sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h;
  }

  toggle() {
    this.expanded = !this.expanded;
  }

  /** 味方の視界に入っているか（ミニマップ表示用）。 */
  static inVision(world: World, m: Mob, team: Team): boolean {
    if (m.team === team) return true;
    if (!world.isVisibleTo(m, team)) return false;
    for (const b of world.bases) {
      if (b.alive && b.team === team && (b.x - m.x) ** 2 + (b.y - m.y) ** 2 < b.vision ** 2) return true;
    }
    let seen = false;
    world.grid.query(m.x, m.y, 600, (o) => {
      if (seen || o.team !== team) return;
      const r = o.kind === 'minion' ? 380 : 600;
      if ((o.x - m.x) ** 2 + (o.y - m.y) ** 2 < r * r) seen = true;
    });
    return seen;
  }

  draw(ctx: CanvasRenderingContext2D, world: World, team: Team, camera: Camera, playerId: number) {
    this.layout(camera.viewW, camera.viewH);
    const { x, y, w, h } = this.rect;
    const land = orient.land;
    // ワールド→ミニマップ。横画面では mx=(H-wy), my=wx の回転写像
    const kx = land ? w / (PLAY_Y1 - PLAY_Y0) : w / (PLAY_X1 - PLAY_X0);
    const ky = land ? h / (PLAY_X1 - PLAY_X0) : h / (PLAY_Y1 - PLAY_Y0);
    const P = (wx: number, wy: number) =>
      land ? { x: x + (PLAY_Y1 - wy) * kx, y: y + (wx - PLAY_X0) * ky } : { x: x + (wx - PLAY_X0) * kx, y: y + (wy - PLAY_Y0) * ky };
    const X = (wx: number, wy: number) => P(wx, wy).x;
    const Y = (wx: number, wy: number) => P(wx, wy).y;
    /** ワールドの矩形をミニマップ上の矩形として塗る（回転しても正しく） */
    const rectW = (x0: number, y0: number, x1: number, y1: number, mode: 'fill' | 'stroke' = 'fill') => {
      const a = P(x0, y0);
      const b = P(x1, y1);
      const rx = Math.min(a.x, b.x);
      const ry = Math.min(a.y, b.y);
      if (mode === 'fill') ctx.fillRect(rx, ry, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      else ctx.strokeRect(rx, ry, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    };
    const unit = Math.min(kx, ky);
    if (this.expanded) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    }
    ctx.fillStyle = 'rgba(20,28,22,0.88)';
    ctx.fillRect(x, y, w, h);
    // 森とレーン
    ctx.fillStyle = '#244a2b';
    for (const st of FOREST_STRIPS) rectW(st.x0, FOREST_Y0, st.x1, FOREST_Y1);
    ctx.fillStyle = 'rgba(190,170,120,0.55)';
    for (const lx of LANE_X) rectW(lx - LANE_WIDTH / 2, PLAY_Y0, lx + LANE_WIDTH / 2, PLAY_Y1);
    rectW(PLAY_X0, PLAY_Y0, PLAY_X1, 450);
    rectW(PLAY_X0, 3150, PLAY_X1, PLAY_Y1);
    // 拠点
    for (const b of world.bases) {
      const r = Math.max(3, b.r * unit * (this.expanded ? 1 : 1.3));
      ctx.fillStyle = b.alive ? teamColor(b.team) : 'rgba(80,80,80,0.8)';
      ctx.beginPath();
      if (b.tier === 'castle') ctx.rect(X(b.x, b.y) - r, Y(b.x, b.y) - r, r * 2, r * 2);
      else ctx.arc(X(b.x, b.y), Y(b.x, b.y), r, 0, Math.PI * 2);
      ctx.fill();
      if (b.gate && b.gate.state !== 'open' && b.alive) {
        ctx.fillStyle = '#ddd';
        rectW(b.gate.x - LANE_WIDTH / 2, b.gate.y - 6, b.gate.x + LANE_WIDTH / 2, b.gate.y + 6);
      }
    }
    // 兵士
    const dot = this.expanded ? 2.5 : 1.6;
    for (const m of world.minions) {
      if (!Minimap.inVision(world, m, team)) continue;
      ctx.fillStyle = teamColor(m.team);
      ctx.fillRect(X(m.x, m.y) - dot / 2, Y(m.x, m.y) - dot / 2, dot, dot);
    }
    // 巨人
    for (const g of world.giants) {
      if (!Minimap.inVision(world, g, team)) continue;
      ctx.fillStyle = teamColor(g.team);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(g.x, g.y), Y(g.x, g.y), this.expanded ? 9 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // キャスト
    ctx.font = `bold ${this.expanded ? 12 : 8}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const hh of world.heroes) {
      if (!hh.alive || !Minimap.inVision(world, hh, team)) continue;
      const r = this.expanded ? 8 : 4.5;
      ctx.fillStyle = teamColor(hh.team);
      ctx.beginPath();
      ctx.arc(X(hh.x, hh.y), Y(hh.x, hh.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hh.id === playerId ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = hh.id === playerId ? 2 : 1;
      ctx.stroke();
      if (this.expanded) {
        ctx.fillStyle = '#fff';
        ctx.fillText(hh.def.glyph, X(hh.x, hh.y), Y(hh.x, hh.y));
      }
    }
    // ソウル召喚予定地点（自軍のみ見える）
    const ann = world.soul.teams[team].announced;
    if (ann) {
      const ap = P(LANE_X[ann.lane], team === 0 ? 2490 : 1110);
      const ax = ap.x;
      const ay = ap.y;
      ctx.fillStyle = '#d9b3ff';
      ctx.font = `900 ${this.expanded ? 18 : 11}px sans-serif`;
      ctx.fillText('魂', ax, ay);
    }
    // ピング
    for (const p of world.pings) {
      if (p.team !== team) continue;
      const k = 1 - p.t / 4;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(p.x, p.y), Y(p.x, p.y), (this.expanded ? 14 : 8) * (1 + (1 - k) * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.font = `900 ${this.expanded ? 14 : 9}px sans-serif`;
      ctx.fillText(PING_ICON[p.kind], X(p.x, p.y), Y(p.x, p.y));
    }
    // カメラの範囲
    const bb = camera.bounds(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    rectW(bb.x0, bb.y0, bb.x1, bb.y1, 'stroke');
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    if (this.expanded) {
      ctx.fillStyle = '#fff';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('タップで閉じる', x + w / 2, y + h + 16);
    }
  }
}
