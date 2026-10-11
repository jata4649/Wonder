// Canvas2D レンダラ。World を読むだけで、World を書き換えない。
import { renderBackground } from './background';
import { Camera } from './camera';
import { drawLaneStatus, drawLevel, drawPlayerStatus, drawSoul, drawTopBar, hudLayout } from './hud';
import { Minimap } from './minimap';
import { WORLD_H, WORLD_W } from '../config/map';
import { teamColor, teamTint } from '../config/settings';
import type { Base } from '../sim/bases';
import type { World } from '../sim/world';
import type { Team } from '../config/types';
import { CROSS, HERO } from '../config/balance';
import { forestAt } from '../config/map';
import type { InputManager } from '../input/touch';
import type { Hero } from '../sim/units/hero';
import type { Effects } from './effects';
import { UprightQueue } from './uprightText';
import { getImage } from './assets';
import { orient, updateOrientation } from '../input/orientation';

export interface RenderView {
  player?: Hero;
  input?: InputManager;
  fx?: Effects;
  dt?: number;
  fps?: number;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  camera = new Camera();
  minimap = new Minimap();
  dpr = 1;
  /** 正立テキスト＆バーのキュー */
  up = new UprightQueue();
  /** 視点のチーム（自軍） */
  viewTeam: Team = 0;
  private bg?: HTMLCanvasElement;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize() {
    updateOrientation();
    document.documentElement.classList.toggle('land', orient.land);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.resize(w, h);
  }

  invalidateBackground() {
    this.bg = undefined;
  }

  render(world: World, view: RenderView = {}) {
    const { ctx, camera } = this;
    if (!this.bg) {
      this.bg = renderBackground(world.walls);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14181f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    camera.apply(ctx, this.dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, 0, 0, this.bg.width, this.bg.height, 0, 0, WORLD_W, WORLD_H);

    this.drawDoors(world);
    this.drawTrails(world);
    for (const b of world.bases) this.drawBase(b);
    this.drawLobMarkers(world);
    this.drawOrbs(world);
    this.drawMinions(world);
    this.drawGiants(world);
    this.drawHeroes(world, view.player);
    this.drawBolts(world);
    this.drawStraight(world);
    this.drawDrawShots(world);
    this.drawLobShells(world);
    view.fx?.draw(ctx, this.up, camera);
    this.drawPings(world);
    if (view.player && view.input) this.drawStance(view.player, view.input);

    // HUD（画面座標）。まずワールド内の文字・バーを正立で描く
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.up.flush(ctx, camera);
    if (view.player && view.input?.gesture.active && view.player.drawStance) this.drawRangeShade(view.player);
    drawTopBar(ctx, world, this.camera.viewW, this.camera.viewH);
    drawLaneStatus(ctx, world, this.viewTeam, this.camera.viewH);
    drawSoul(ctx, world, this.viewTeam, this.camera.viewH);
    drawLevel(ctx, world, this.viewTeam, this.camera.viewH);
    if (view.player) drawPlayerStatus(ctx, view.player, this.camera.viewH);
    if (view.input) this.drawStick(view.input);
    this.minimap.drawCached(ctx, world, this.viewTeam, this.camera, view.player?.id ?? -1, this.dpr, view.dt ?? 1 / 60);
    if (view.fps !== undefined) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const fp = hudLayout(this.camera.viewH).fps;
      ctx.fillRect(fp.x, fp.y, 70, 20);
      ctx.fillStyle = view.fps >= 55 ? '#7CFC8A' : view.fps >= 40 ? '#ffd23f' : '#ff6b6b';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${view.fps.toFixed(0)} fps`, fp.x + 6, fp.y + 10);
    }
    if (view.player?.notice) this.drawNotice(view.player.notice.text);
    view.fx?.drawScreen(ctx, this.camera.viewW, this.camera.viewH);
  }

  /** 画面下方向にずらした影（向きに関係なく画面上で横長の楕円）。 */
  private shadow(x: number, y: number, rx: number, ry: number, off: number, alpha = 0.35) {
    const { ctx, camera } = this;
    const u = camera.up;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x - u.x * off, y - u.y * off, rx, ry, camera.land ? Math.PI / 2 : 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawOrbs(world: World) {
    const { ctx } = this;
    const bb = this.camera.bounds();
    const pulse = 1 + Math.sin(world.time * 8) * 0.15;
    for (const o of world.orbs) {
      if (o.x < bb.x0 || o.x > bb.x1 || o.y < bb.y0 || o.y > bb.y1) continue;
      const s = (7 + Math.min(8, o.value * 2)) * pulse;
      ctx.globalAlpha = o.t < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(o.t * 10)) : 1;
      ctx.fillStyle = o.team === this.viewTeam ? '#7cf0ff' : '#c9a3ff';
      ctx.beginPath();
      ctx.moveTo(o.x, o.y - s);
      ctx.lineTo(o.x + s * 0.7, o.y);
      ctx.lineTo(o.x, o.y + s);
      ctx.lineTo(o.x - s * 0.7, o.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** クロスドロー用の軌跡（インク）。約20秒かけて薄れる。 */
  private drawTrails(world: World) {
    const { ctx } = this;
    const bb = this.camera.bounds();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const t of world.trails) {
      if (t.bbox.x1 < bb.x0 || t.bbox.x0 > bb.x1 || t.bbox.y1 < bb.y0 || t.bbox.y0 > bb.y1) continue;
      const life = t.t / CROSS.trailLifeSec;
      const mine = t.team === this.viewTeam;
      ctx.globalAlpha = 0.12 + 0.4 * life;
      ctx.strokeStyle = t.crossed ? '#ffd23f' : teamColor(t.team);
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(t.pts[0].x, t.pts[0].y);
      for (let i = 1; i < t.pts.length; i++) ctx.lineTo(t.pts[i].x, t.pts[i].y);
      ctx.stroke();
      // 墨のにじみ（端点の玉）
      ctx.fillStyle = ctx.strokeStyle;
      const e = t.pts[t.pts.length - 1];
      ctx.beginPath();
      ctx.arc(e.x, e.y, 12, 0, Math.PI * 2);
      ctx.fill();
      if (mine) {
        ctx.globalAlpha = 0.25 + 0.5 * life;
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 12]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  private drawPings(world: World) {
    const { ctx } = this;
    const icon: Record<string, string> = { gather: '集合', retreat: '退却', caution: '注意', enemy: '敵' };
    for (const p of world.pings) {
      if (p.team !== this.viewTeam) continue;
      const k = (p.t % 1) / 1;
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 40 + 40 * (1 - k), 0, Math.PI * 2);
      ctx.stroke();
      this.up.text(p.x, p.y, icon[p.kind], { size: 24, weight: '900', color: '#ffd23f', dy: 93, bg: 'rgba(0,0,0,0.6)' });
    }
  }

  private drawGiants(world: World) {
    const { ctx } = this;
    for (const g of world.giants) {
      if (!world.isVisibleTo(g, this.viewTeam)) continue;
      const col = teamColor(g.team);
      if (g.def.auraRadius) {
        ctx.fillStyle = teamTint(g.team, 0.1);
        ctx.strokeStyle = teamTint(g.team, 0.5);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.def.auraRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      this.shadow(g.x, g.y, g.r * 1.1, g.r * 0.5, g.r * 0.6, 0.4);
      const wob = Math.sin(world.time * 6) * 3;
      const u = this.camera.up;
      const gx = g.x + u.x * wob;
      const gy = g.y + u.y * wob;
      const img = getImage('giants', g.def.type);
      ctx.fillStyle = g.hitFlash > 0 ? '#fff' : col;
      ctx.beginPath();
      ctx.arc(gx, gy, g.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 6;
      ctx.stroke();
      if (g.swing > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r + 30, world.time * 12, world.time * 12 + 3);
        ctx.stroke();
      }
      if (img) this.up.image(gx, gy, img, g.r * 2.6, g.r * 2.6, -g.r * 1.1, g.hitFlash > 0 ? 0.6 : 1);
      else this.up.text(gx, gy, g.def.glyph, { size: g.r, weight: '900' });
      this.up.bar(g.x, g.y, 130, 12, g.hp / g.maxHp, '#ffd23f', g.r + 20, 'rgba(0,0,0,0.7)');
      this.up.text(g.x, g.y, g.def.name, { size: 18, dy: g.r + 42, stroke: 'rgba(0,0,0,0.7)' });
      if (g.downTimer > 0) this.up.text(g.x, g.y, 'DOWN', { size: 18, color: '#ffd23f', dy: -(g.r + 20) });
    }
  }

  // ---- キャスト ----
  private drawHeroes(world: World, player?: Hero) {
    const { ctx } = this;
    const bb = this.camera.bounds();
    for (const h of world.heroes) {
      if (!h.alive) continue;
      if (h.x < bb.x0 || h.x > bb.x1 || h.y < bb.y0 || h.y > bb.y1) continue;
      const visible = world.isVisibleTo(h, this.viewTeam);
      if (!visible) continue;
      const hidden = h.team === this.viewTeam && forestAt(h.x, h.y) >= 0;
      const z = h.z;
      const col = teamColor(h.team);
      // 影（跳躍中は小さく）
      this.shadow(h.x, h.y, h.r * (1 - z / 400), h.r * 0.45 * (1 - z / 400), h.r * 0.7);
      // 跳躍の高さは画面の上方向へ
      const u = this.camera.up;
      const hx = h.x + u.x * z;
      const y = h.y + u.y * z;
      ctx.globalAlpha = hidden ? 0.65 : 1;
      // 攻撃姿勢（相手にも見える白いエフェクト）
      if (h.drawStance) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 4;
        const t = world.time * 6;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(hx, y, h.r + 10 + i * 5, t + i * 2, t + i * 2 + 1.6);
          ctx.stroke();
        }
      }
      if (h.invulnTimer > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(hx, y, h.r + 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = h.hitFlash > 0 ? '#fff' : h.def.color;
      ctx.beginPath();
      ctx.arc(hx, y, h.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 6;
      ctx.stroke();
      if (h === player) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, y, h.r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 向き
      const fl = Math.hypot(h.faceX, h.faceY) || 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(hx + (h.faceX / fl) * (h.r + 6), y + (h.faceY / fl) * (h.r + 6), 6, 0, Math.PI * 2);
      ctx.fill();
      const img = getImage('casters', h.def.id);
      if (img) this.up.image(hx, y, img, h.r * 2.6, h.r * 2.6, -h.r * 1.1, hidden ? 0.65 : 1);
      else this.up.text(hx, y, h.def.glyph, { size: 26, color: h.def.accent, alpha: hidden ? 0.65 : 1 });
      // HP/MP（正立のバー）
      this.up.bar(hx, y, 64, 9, h.hp / h.maxHp, h.team === this.viewTeam ? '#7CFC8A' : '#ff6b6b', h.r + 17.5);
      if (h.team === this.viewTeam) this.up.bar(hx, y, 64, 5, h.mp / h.stat('maxMp'), '#5ab8ff', h.r + 9.5);
      this.up.text(hx, y, h.def.name, { size: 14, dy: h.r + 32, stroke: 'rgba(0,0,0,0.7)', color: h === player ? '#ffd23f' : '#fff', alpha: hidden ? 0.65 : 1 });
      if (h.downTimer > 0) this.up.text(hx, y, 'DOWN', { size: 18, color: '#ffd23f', dy: -(h.r + 18) });
      ctx.globalAlpha = 1;
    }
  }

  private drawStraight(world: World) {
    const { ctx } = this;
    for (const s of world.straightShots) {
      const sp = Math.hypot(s.vx, s.vy) || 1;
      ctx.strokeStyle = teamColor(s.team);
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x - (s.vx / sp) * 30, s.y - (s.vy / sp) * 30);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  private drawDrawShots(world: World) {
    const { ctx } = this;
    for (const p of world.drawShots) {
      const r = p.width / 2;
      // 残像
      for (let i = 0; i < p.history.length; i++) {
        const q = p.history[i];
        ctx.globalAlpha = (i / p.history.length) * 0.35;
        ctx.fillStyle = teamColor(p.team);
        ctx.beginPath();
        ctx.arc(q.x, q.y, r * (0.5 + (0.5 * i) / p.history.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = teamColor(p.team);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      if (p.crossed) {
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** 投擲弾の着弾点（敵味方どちらにも見える）。 */
  private drawLobMarkers(world: World) {
    const { ctx } = this;
    for (const s of world.lobs) {
      const k = s.t / s.T;
      ctx.fillStyle = teamTint(s.team, 0.18 + 0.2 * k);
      ctx.strokeStyle = teamColor(s.team);
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.arc(s.tx, s.ty, s.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(s.tx, s.ty, s.radius * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawLobShells(world: World) {
    const { ctx } = this;
    for (const s of world.lobs) {
      const k = Math.min(1, s.t / s.T);
      const hgt = Math.sin(k * Math.PI) * 180;
      const u = this.camera.up;
      const x = s.x0 + (s.tx - s.x0) * k + u.x * hgt;
      const y = s.y0 + (s.ty - s.y0) * k + u.y * hgt;
      ctx.fillStyle = teamColor(s.team);
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 攻撃姿勢中の軌跡プレビュー。 */
  private drawStance(h: Hero, input: InputManager) {
    const g = input.gesture;
    if (!g.active || !h.drawStance || g.pts.length < 1) return;
    const { ctx } = this;
    const d = h.def.draw;
    const range = h.stat('drawRange');
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(h.x, h.y, range, 0, Math.PI * 2);
    ctx.stroke();
    // キャンセル判定
    ctx.strokeStyle = 'rgba(255,120,120,0.6)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(h.x, h.y, HERO.cancelRadius + h.r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const pts = g.pts;
    const last = pts[pts.length - 1];
    if (d.type === 'curve') {
      const frac = Math.min(1, g.length / d.drawLength);
      ctx.strokeStyle = frac > 0.85 ? '#ffb347' : '#ffffff';
      ctx.lineWidth = d.width * 0.55;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // 残り描線長ゲージ
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r + 22, -Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
      ctx.strokeStyle = frac > 0.85 ? '#ffb347' : '#7cf0ff';
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r + 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - frac));
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      if (d.type === 'charge') {
        const dx = last.x - h.x;
        const dy = last.y - h.y;
        const L = Math.min(range, Math.hypot(dx, dy)) / (Math.hypot(dx, dy) || 1);
        ctx.lineTo(h.x + dx * L, h.y + dy * L);
      } else {
        // 放物線のイメージ
        const u = this.camera.up;
        const mx = (h.x + last.x) / 2 + u.x * 120;
        const my = (h.y + last.y) / 2 + u.y * 120;
        ctx.quadraticCurveTo(mx, my, last.x, last.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const R = d.type === 'lob' ? (d.lobRadius ?? 100) : (d.aoeRadius ?? 100);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(last.x, last.y, d.type === 'charge' ? R : R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  /** 攻撃姿勢中、射程外の領域を暗く表示。 */
  private drawRangeShade(h: Hero) {
    const { ctx, camera } = this;
    const c = camera.worldToScreen(h.x, h.y);
    const r = h.stat('drawRange') * camera.scale;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.rect(0, 0, camera.viewW, camera.viewH);
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
  }

  private drawStick(input: InputManager) {
    const s = input.stick;
    if (!s.active) return;
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.ox, s.oy, s.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const v = s.vector();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(s.ox + v.x * s.radius, s.oy + v.y * s.radius, 24, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawNotice(text: string) {
    const { ctx, camera } = this;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 30;
    ctx.fillStyle = 'rgba(160,20,30,0.85)';
    ctx.beginPath();
    ctx.roundRect(camera.viewW / 2 - w / 2, camera.viewH * 0.36 - 20, w, 40, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, camera.viewW / 2, camera.viewH * 0.36);
  }

  private drawMinions(world: World) {
    const { ctx } = this;
    const bb = this.camera.bounds();
    for (const m of world.minions) {
      if (m.x < bb.x0 || m.x > bb.x1 || m.y < bb.y0 || m.y > bb.y1) continue;
      if (!world.isVisibleTo(m, this.viewTeam)) continue;
      const col = teamColor(m.team);
      const forming = m.squad.formTimer > 0 && !m.ramming;
      const img = getImage('minions', `${m.team === this.viewTeam ? 'ally' : 'enemy'}_${m.big ? 'large' : 'small'}`);
      ctx.globalAlpha = m.downTimer > 0 ? 0.6 : 1;
      ctx.fillStyle = m.hitFlash > 0 ? '#fff' : col;
      ctx.beginPath();
      if (img) {
        ctx.arc(m.x, m.y, m.r * 0.9, 0, Math.PI * 2);
      } else if (m.big) {
        ctx.roundRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2, 6);
      } else {
        // 進行方向に尖った形
        const f = m.team === 0 ? -1 : 1;
        ctx.moveTo(m.x, m.y + f * m.r * 1.2);
        ctx.lineTo(m.x + m.r, m.y - f * m.r * 0.8);
        ctx.lineTo(m.x - m.r, m.y - f * m.r * 0.8);
        ctx.closePath();
      }
      ctx.fill();
      ctx.strokeStyle = m.ramming ? '#ffd23f' : 'rgba(0,0,0,0.55)';
      ctx.lineWidth = m.ramming ? 4 : 2;
      ctx.stroke();
      if (forming) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (img) this.up.image(m.x, m.y, img, m.r * 2.8, m.r * 2.8, -m.r * 1.2, m.downTimer > 0 ? 0.6 : 1);
      else if (m.big) this.up.text(m.x, m.y, '大', { size: 18, weight: '900', color: '#fff' });
      if (m.hp < m.maxHp) this.up.bar(m.x, m.y, m.r * 2, 5, m.hp / m.maxHp, '#7CFC8A', m.r + 7.5, 'rgba(0,0,0,0.6)');
      ctx.globalAlpha = 1;
    }
  }

  private drawBolts(world: World) {
    const { ctx } = this;
    for (const b of world.bolts) {
      ctx.fillStyle = teamColor(b.team);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawDoors(world: World) {
    const { ctx } = this;
    for (const w of world.walls) {
      if (!w.door) continue;
      const fb = world.frontBase(w.door.team, w.door.lane);
      const closed = !!fb?.alive;
      if (closed) {
        ctx.fillStyle = '#0f1d12';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = teamTint(w.door.team, 0.55);
        for (let y = w.y + 10; y < w.y + w.h; y += 22) {
          ctx.beginPath();
          ctx.arc(w.x + w.w / 2, y, 13, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(140,120,80,0.6)';
        ctx.fillRect(w.x, w.y + 6, w.w, w.h - 12);
      }
    }
  }

  private drawBase(b: Base) {
    const { ctx } = this;
    const col = teamColor(b.team);
    // 門
    if (b.gate) {
      const g = b.gate;
      const half = 135;
      if (g.state !== 'open') {
        ctx.fillStyle = g.state === 'closed' ? '#2a2d36' : '#3d4150';
        ctx.fillRect(g.x - half, g.y - 14, half * 2, 28);
        ctx.strokeStyle = col;
        ctx.lineWidth = 5;
        ctx.strokeRect(g.x - half, g.y - 14, half * 2, 28);
        // 格子
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 3;
        for (let x = g.x - half + 18; x < g.x + half; x += 22) {
          ctx.beginPath();
          ctx.moveTo(x, g.y - 12);
          ctx.lineTo(x, g.y + 12);
          ctx.stroke();
        }
        const label = g.kind === 'yukyu' ? '悠久門' : '刹那門';
        const txt = g.state === 'opening' ? `${label} 開門 ${Math.ceil(g.timer)}s` : `${label} 🔒`;
        this.up.text(g.x, g.y, txt, { size: 24, dy: 40, bg: 'rgba(0,0,0,0.6)' });
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(g.x - half, g.y - 6, 26, 12);
        ctx.fillRect(g.x + half - 26, g.y - 6, 26, 12);
      }
    }

    if (!b.alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 4;
      ctx.stroke();
      return;
    }
    const flash = b.hitFlash > 0;
    this.shadow(b.x, b.y, b.r * 1.05, b.r * 0.5, b.r * 0.5);
    const img = getImage('bases', b.tier === 'castle' ? (b.team === this.viewTeam ? 'castle_ally' : 'castle_enemy') : b.def.kind);
    const KIND_NAME = { small: '小拠点', normal: '拠点', large: '大拠点', huge: '特大拠点', castle: '城' } as const;

    if (b.tier === 'castle') {
      // 城：塔の形
      const r = b.r;
      if (!img) {
        ctx.fillStyle = flash ? '#fff' : col;
        ctx.beginPath();
        ctx.roundRect(b.x - r, b.y - r * 0.7, r * 2, r * 1.4, 16);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = -2; i <= 2; i++) ctx.fillRect(b.x + i * r * 0.4 - 12, b.y - r * 0.9, 24, 30);
      }
      if (img) this.up.image(b.x, b.y, img, r * 2.4, r * 2.4, -r * 0.9, flash ? 0.7 : 1);
      else this.up.text(b.x, b.y, '城', { size: r * 0.7 });
      return;
    }
    const sides = b.def.kind === 'small' ? 4 : b.def.kind === 'normal' ? 6 : b.def.kind === 'large' ? 8 : 10;
    ctx.fillStyle = flash ? '#fff' : col;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const px = b.x + Math.cos(a) * b.r;
      const py = b.y + Math.sin(a) * b.r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 5;
    ctx.stroke();
    // HPリング
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#7CFC8A';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.62, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * b.hp) / b.maxHp);
    ctx.stroke();
    if (img) this.up.image(b.x, b.y, img, b.r * 2.2, b.r * 2.2, -b.r * 0.9, flash ? 0.7 : 1);
    const label = { small: '小', normal: '拠', large: '大', huge: '特', castle: '城' }[b.def.kind];
    if (!img) this.up.text(b.x, b.y, label, { size: Math.round(b.r * 0.55) });
    this.up.text(b.x, b.y, KIND_NAME[b.def.kind], { size: 18, dy: -(b.r + 18), stroke: 'rgba(0,0,0,0.7)' });
    if (b.gate && b.gate.state !== 'open') {
      // 無敵（門が閉じている）表示
      ctx.strokeStyle = 'rgba(200,220,255,0.7)';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
