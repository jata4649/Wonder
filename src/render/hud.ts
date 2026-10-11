// キャンバス上の HUD（ゲージ・タイマーなど）。
import { MATCH } from '../config/balance';
import { teamColor } from '../config/settings';
import type { Team } from '../config/types';
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
  const y = 48 + safeTop();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, 128, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.font = '900 16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Lv${p.level}`, x + 8, y + 13);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`敵Lv${ep.level}`, x + 76, y + 13);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x + 8, y + 24, 112, 5);
  ctx.fillStyle = '#7cf0ff';
  ctx.fillRect(x + 8, y + 24, 112 * p.progress(), 5);
}
