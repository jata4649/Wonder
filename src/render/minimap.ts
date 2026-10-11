// ミニマップ（右上）。タップで拡大／もう一度タップで戻す。
// 敵は「味方の視界（キャスト・兵士・拠点）」に入っていて、かつ森に隠れていないものだけ表示。
import { FOREST_STRIPS, FOREST_Y0, FOREST_Y1, LANE_WIDTH, LANE_X, PLAY_X0, PLAY_X1, PLAY_Y0, PLAY_Y1 } from '../config/map';
import { teamColor } from '../config/settings';
import type { Team } from '../config/types';
import type { Mob } from '../sim/units/types';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import { safeTop } from './hud';

const PING_ICON: Record<string, string> = { gather: '集', retreat: '退', caution: '!', enemy: '敵' };

export class Minimap {
  expanded = false;
  rect = { x: 0, y: 0, w: 0, h: 0 };

  layout(viewW: number, viewH: number) {
    const mapW = PLAY_X1 - PLAY_X0;
    const mapH = PLAY_Y1 - PLAY_Y0;
    if (this.expanded) {
      const h = Math.min(viewH * 0.72, ((viewW - 40) * mapH) / mapW);
      const w = (h * mapW) / mapH;
      this.rect = { x: (viewW - w) / 2, y: (viewH - h) / 2, w, h };
    } else {
      const w = Math.min(100, viewW * 0.26);
      const h = (w * mapH) / mapW;
      this.rect = { x: viewW - w - 8, y: 46 + safeTop(), w, h };
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
    const sx = w / (PLAY_X1 - PLAY_X0);
    const sy = h / (PLAY_Y1 - PLAY_Y0);
    const X = (wx: number) => x + (wx - PLAY_X0) * sx;
    const Y = (wy: number) => y + (wy - PLAY_Y0) * sy;
    if (this.expanded) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, camera.viewW, camera.viewH);
    }
    ctx.fillStyle = 'rgba(20,28,22,0.88)';
    ctx.fillRect(x, y, w, h);
    // 森とレーン
    ctx.fillStyle = '#244a2b';
    for (const s of FOREST_STRIPS) ctx.fillRect(X(s.x0), Y(FOREST_Y0), (s.x1 - s.x0) * sx, (FOREST_Y1 - FOREST_Y0) * sy);
    ctx.fillStyle = 'rgba(190,170,120,0.55)';
    for (const lx of LANE_X) ctx.fillRect(X(lx - LANE_WIDTH / 2), y, LANE_WIDTH * sx, h);
    ctx.fillRect(x, Y(PLAY_Y0), w, (450 - PLAY_Y0) * sy);
    ctx.fillRect(x, Y(3150), w, (PLAY_Y1 - 3150) * sy);
    // 拠点
    for (const b of world.bases) {
      const r = Math.max(3, b.r * sx * (this.expanded ? 1 : 1.3));
      ctx.fillStyle = b.alive ? teamColor(b.team) : 'rgba(80,80,80,0.8)';
      ctx.beginPath();
      if (b.tier === 'castle') ctx.rect(X(b.x) - r, Y(b.y) - r * 0.7, r * 2, r * 1.4);
      else ctx.arc(X(b.x), Y(b.y), r, 0, Math.PI * 2);
      ctx.fill();
      if (b.gate && b.gate.state !== 'open' && b.alive) {
        ctx.fillStyle = '#ddd';
        ctx.fillRect(X(b.gate.x - LANE_WIDTH / 2), Y(b.gate.y) - 1, LANE_WIDTH * sx, 2);
      }
    }
    // 兵士
    const dot = this.expanded ? 2.5 : 1.6;
    for (const m of world.minions) {
      if (!Minimap.inVision(world, m, team)) continue;
      ctx.fillStyle = teamColor(m.team);
      ctx.fillRect(X(m.x) - dot / 2, Y(m.y) - dot / 2, dot, dot);
    }
    // 巨人
    for (const g of world.giants) {
      if (!Minimap.inVision(world, g, team)) continue;
      ctx.fillStyle = teamColor(g.team);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(g.x), Y(g.y), this.expanded ? 9 : 5, 0, Math.PI * 2);
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
      ctx.arc(X(hh.x), Y(hh.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hh.id === playerId ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = hh.id === playerId ? 2 : 1;
      ctx.stroke();
      if (this.expanded) {
        ctx.fillStyle = '#fff';
        ctx.fillText(hh.def.glyph, X(hh.x), Y(hh.y));
      }
    }
    // ソウル召喚予定地点（自軍のみ見える）
    const ann = world.soul.teams[team].announced;
    if (ann) {
      const ax = X(LANE_X[ann.lane]);
      const ay = Y(team === 0 ? 2490 : 1110);
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
      ctx.arc(X(p.x), Y(p.y), (this.expanded ? 14 : 8) * (1 + (1 - k) * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.font = `900 ${this.expanded ? 14 : 9}px sans-serif`;
      ctx.fillText(PING_ICON[p.kind], X(p.x), Y(p.y));
    }
    // カメラの範囲
    const bb = camera.bounds(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(X(bb.x0), Y(bb.y0), (bb.x1 - bb.x0) * sx, (bb.y1 - bb.y0) * sy);
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
