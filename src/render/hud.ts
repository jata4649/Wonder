// キャンバス上の HUD（ゲージ・タイマーなど）。
import { MATCH } from '../config/balance';
import { teamColor } from '../config/settings';
import type { Team } from '../config/types';
import type { Hero } from '../sim/units/hero';
import type { World } from '../sim/world';

export function fmtTime(sec: number) {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function drawTopBar(ctx: CanvasRenderingContext2D, world: World, w: number) {
  const m = world.match;
  const barW = Math.min(150, (w - 110) / 2);
  const cx = w / 2;
  const y = 10 + safeTop();
  // タイマー
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(cx - 40, y, 80, 30, 8);
  ctx.fill();
  ctx.fillStyle = m.timeLeft < 60 ? '#ff6b6b' : '#fff';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fmtTime(m.timeLeft), cx, y + 16);
  // ゲージ（左=自軍, 右=敵軍）
  for (const team of [0, 1] as const) {
    const x0 = team === 0 ? cx - 46 - barW : cx + 46;
    const frac = m.gauge[team] / MATCH.teamGaugeMax;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x0, y + 4, barW, 22);
    ctx.fillStyle = teamColor(team);
    if (team === 0) ctx.fillRect(x0 + barW * (1 - frac), y + 4, barW * frac, 22);
    else ctx.fillRect(x0, y + 4, barW * frac, 22);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y + 4, barW, 22);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = team === 0 ? 'right' : 'left';
    ctx.fillText(m.gauge[team].toFixed(1), team === 0 ? x0 + barW - 6 : x0 + 6, y + 16);
  }
}

let cachedSafeTop = -1;
export function safeTop() {
  if (cachedSafeTop < 0) {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--sat');
    cachedSafeTop = parseInt(v) || 0;
  }
  return cachedSafeTop;
}

/** チームレベルと経験値バー（左上・ソウルゲージの下）。 */
export function drawLevel(ctx: CanvasRenderingContext2D, world: World, team: Team, _w: number) {
  const p = world.progress[team];
  const ep = world.progress[(1 - team) as Team];
  const x = 10;
  const y = 94 + safeTop();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, 106, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.font = '900 16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Lv${p.level}`, x + 8, y + 13);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`敵Lv${ep.level}`, x + 60, y + 13);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x + 8, y + 24, 90, 5);
  ctx.fillStyle = '#7cf0ff';
  ctx.fillRect(x + 8, y + 24, 90 * p.progress(), 5);
}

const LANE_NAME = ['左', '中央', '右'];

/** ソウルゲージ（左上）。半分で次のソウルを予告（自軍のみ）。 */
export function drawSoul(ctx: CanvasRenderingContext2D, world: World, team: Team) {
  const st = world.soul.teams[team];
  const x = 10;
  const y = 48 + safeTop();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, 106, 42, 8);
  ctx.fill();
  ctx.fillStyle = '#d9b3ff';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ソウル', x + 8, y + 11);
  const frac = st.gauge / 100;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x + 48, y + 6, 50, 10);
  const grad = ctx.createLinearGradient(x + 48, 0, x + 98, 0);
  grad.addColorStop(0, '#9b5cff');
  grad.addColorStop(1, '#ff7ad9');
  ctx.fillStyle = grad;
  ctx.fillRect(x + 48, y + 6, 50 * frac, 10);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(x + 73, y + 4);
  ctx.lineTo(x + 73, y + 18);
  ctx.stroke();
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  const a = st.announced;
  const giant = world.giants.find((g) => g.team === team);
  const txt = giant ? `巨人出撃中(${LANE_NAME[giant.lane]})` : a ? `${a.soul.name}(${LANE_NAME[a.lane]})` : '劣勢ほど溜まる';
  ctx.fillText(txt, x + 8, y + 30);
}

/** 自キャストの HP/MP（左下）。 */
export function drawPlayerStatus(ctx: CanvasRenderingContext2D, h: Hero, viewH: number) {
  const x = 12;
  const y = viewH - 64 - safeBottom();
  const w = 150;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(x, y, w + 16, 52, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(h.def.name, x + 8, y + 10);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#aaa';
  ctx.fillText(h.alive ? `K${h.kills} / D${h.deaths}` : `復活まで ${Math.ceil(h.respawnTimer)}`, x + w + 8, y + 10);
  const bar = (by: number, frac: number, col: string, label: string) => {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 8, by, w, 11);
    ctx.fillStyle = col;
    ctx.fillRect(x + 8, by, w * Math.max(0, Math.min(1, frac)), 11);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 12, by + 6);
  };
  bar(y + 21, h.hp / h.maxHp, h.hp / h.maxHp < 0.3 ? '#ff5d5d' : '#5bd66b', `HP ${Math.ceil(h.hp)}/${h.maxHp}`);
  const maxMp = h.stat('maxMp');
  bar(y + 36, h.mp / maxMp, h.mp < h.drawCost ? '#4a5e80' : '#4fa8ff', `MP ${Math.floor(h.mp)}/${maxMp}`);
}

let cachedSafeBottom = -1;
export function safeBottom() {
  if (cachedSafeBottom < 0) {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--sab');
    cachedSafeBottom = parseInt(v) || 0;
  }
  return cachedSafeBottom;
}
