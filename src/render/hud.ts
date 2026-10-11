// キャンバス上の HUD。横画面の画面構成（SPEC 1.2）に従ってゾーンを分ける：
//  上部バー（自軍ゲージ｜残り時間｜敵軍ゲージ）、左上＝レーン状況→ソウル→レベル、右上＝ミニマップ、左下＝自キャスト情報。
import { MATCH } from '../config/balance';
import { teamColor } from '../config/settings';
import type { LaneId, Team } from '../config/types';
import { laneName, orient } from '../input/orientation';
import type { Hero } from '../sim/units/hero';
import { casterIcon, uiImg } from './assets';
import type { World } from '../sim/world';

export function fmtTime(sec: number) {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 上部バーの高さ：clamp(34px, 9vh, 48px)。 */
export function topBarHeight(viewH: number) {
  return Math.max(34, Math.min(48, viewH * 0.09));
}

/** 左上の HUD 列の位置。 */
export function hudLayout(viewH: number) {
  const top = topBarHeight(viewH) + 6 + safeTop();
  const laneH = orient.land ? 54 : 0; // 縦画面ではレーン状況を省略（ミニマップで代替）
  const lane = { x: 8, y: top };
  const soul = { x: 8, y: top + (laneH ? laneH + 4 : 0) };
  const level = { x: 8, y: soul.y + 46 };
  const fps = { x: 8, y: level.y + 40 };
  return { top, lane, soul, level, fps, laneH };
}

export function drawTopBar(ctx: CanvasRenderingContext2D, world: World, w: number, viewH: number) {
  const m = world.match;
  const H = topBarHeight(viewH);
  const timerW = 76;
  const barW = Math.max(80, Math.min(orient.land ? 300 : 150, (w - timerW - 40) / 2));
  const cx = w / 2;
  const y = 4 + safeTop();
  const bh = H - 12;
  // タイマー
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(cx - timerW / 2, y, timerW, H - 8, 8);
  ctx.fill();
  ctx.fillStyle = m.timeLeft < 60 ? '#ff6b6b' : '#fff';
  ctx.font = `bold ${Math.round(H * 0.45)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fmtTime(m.timeLeft), cx, y + (H - 8) / 2 + 1);
  // ゲージ（左=自軍, 右=敵軍）
  for (const team of [0, 1] as const) {
    const x0 = team === 0 ? cx - timerW / 2 - 6 - barW : cx + timerW / 2 + 6;
    const frac = m.gauge[team] / MATCH.teamGaugeMax;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x0, y + 2, barW, bh);
    ctx.fillStyle = teamColor(team);
    if (team === 0) ctx.fillRect(x0 + barW * (1 - frac), y + 2, barW * frac, bh);
    else ctx.fillRect(x0, y + 2, barW * frac, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y + 2, barW, bh);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(bh * 0.6)}px system-ui, sans-serif`;
    ctx.textAlign = team === 0 ? 'right' : 'left';
    ctx.fillText(m.gauge[team].toFixed(1), team === 0 ? x0 + barW - 6 : x0 + 6, y + 2 + bh / 2 + 1);
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

/**
 * レーン状況（左上）：盤面と同じ向き（左・中央・右の列、上＝敵陣・下＝自陣）で
 * 各レーンの「奥／門／手前」をドットで表示。
 */
export function drawLaneStatus(ctx: CanvasRenderingContext2D, world: World, team: Team, viewH: number) {
  const L = hudLayout(viewH);
  if (!L.laneH) return;
  const { x, y } = L.lane;
  const w = 106;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, L.laneH, 8);
  ctx.fill();
  const enemy = (1 - team) as Team;
  const rows: { t: Team; tier: 'deep' | 'front' | 'gate' }[] = [
    { t: enemy, tier: 'deep' },
    { t: enemy, tier: 'gate' },
    { t: enemy, tier: 'front' },
    { t: team, tier: 'front' },
    { t: team, tier: 'gate' },
    { t: team, tier: 'deep' },
  ];
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const lane of [0, 1, 2] as LaneId[]) {
    const cx = x + 22 + lane * 31;
    ctx.fillStyle = '#bbb';
    rows.forEach((it, i) => {
      const ry = y + 6 + i * 6.4 + (i >= 3 ? 3 : 0);
      if (it.tier === 'gate') {
        const deep = world.deepBase(it.t, lane);
        const g = deep?.gate;
        ctx.fillStyle = !g || !deep?.alive || g.state === 'open' ? 'rgba(255,255,255,0.2)' : g.state === 'opening' ? '#ffd23f' : '#cfd6e6';
        ctx.fillRect(cx - 6, ry - 1, 12, 2.5);
        return;
      }
      const b = it.tier === 'front' ? world.frontBase(it.t, lane) : world.deepBase(it.t, lane);
      ctx.beginPath();
      ctx.arc(cx, ry, 2.8, 0, Math.PI * 2);
      if (b?.alive) {
        ctx.fillStyle = teamColor(it.t);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
    ctx.fillStyle = '#ccc';
    ctx.fillText(laneName(lane), cx, y + L.laneH - 6);
  }
}

/** チームレベルと経験値バー（左上・ソウルゲージの下）。 */
export function drawLevel(ctx: CanvasRenderingContext2D, world: World, team: Team, viewH: number) {
  const p = world.progress[team];
  const ep = world.progress[(1 - team) as Team];
  const { x, y } = hudLayout(viewH).level;
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

/** ソウルゲージ（左上）。半分で次のソウルを予告（自軍のみ）。 */
export function drawSoul(ctx: CanvasRenderingContext2D, world: World, team: Team, viewH: number) {
  const st = world.soul.teams[team];
  const { x, y } = hudLayout(viewH).soul;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, 106, 42, 8);
  ctx.fill();
  ctx.fillStyle = '#d9b3ff';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const orb = uiImg('spiritOrb');
  if (orb) {
    const k = st.gauge >= 50 ? 1 + Math.sin(performance.now() / 150) * 0.06 : 1;
    ctx.drawImage(orb, x + 4, y + 1, 20 * k, 20 * k * (orb.height / orb.width));
    ctx.fillText('ソウル', x + 24, y + 11);
  } else ctx.fillText('ソウル', x + 8, y + 11);
  const frac = st.gauge / 100;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  const bx = x + 60;
  const bw = 40;
  ctx.fillRect(bx, y + 6, bw, 10);
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, '#9b5cff');
  grad.addColorStop(1, '#ff7ad9');
  ctx.fillStyle = grad;
  ctx.fillRect(bx, y + 6, bw * frac, 10);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(bx + bw / 2, y + 4);
  ctx.lineTo(bx + bw / 2, y + 18);
  ctx.stroke();
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  const a = st.announced;
  const giant = world.giants.find((g) => g.team === team);
  const txt = giant ? `巨人出撃中(${laneName(giant.lane)})` : a ? `${a.soul.name}(${laneName(a.lane)})` : '劣勢ほど溜まる';
  ctx.fillText(txt, x + 8, y + 30);
}

const BUFF_LABEL: Record<string, [string, string]> = {
  haste: ['速', '#7CFC8A'],
  guard: ['護', '#8fd0ff'],
  empower: ['攻', '#ffb347'],
  pierceUp: ['貫', '#ffd23f'],
  slow: ['鈍', '#ff6b6b'],
};

/** 自キャストの名前・HP・MP・バフ（左下）。カードの真横に置かない。 */
export function drawPlayerStatus(ctx: CanvasRenderingContext2D, h: Hero, viewH: number) {
  const x = 10;
  const y = viewH - 62 - safeBottom();
  const w = 150;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(x, y, w + 16, 54, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // 丸アイコン（HUD の小枠）
  const icon = casterIcon(h.def.id);
  let nx = x + 8;
  if (icon) {
    ctx.save();
    if (!h.alive) ctx.globalAlpha = 0.4;
    ctx.drawImage(icon, x + 4, y - 30, 34, 34);
    ctx.restore();
    nx = x + 42;
  }
  ctx.fillText(h.def.name, nx, y + 10);
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
  // バフ
  h.buffs.forEach((b, i) => {
    const [label, col] = BUFF_LABEL[b.kind] ?? ['?', '#fff'];
    const bx = x + 8 + i * 22;
    const by = y - 20;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, 20, 17);
    ctx.fillStyle = col;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + 10, by + 9);
  });
}

let cachedSafeBottom = -1;
export function safeBottom() {
  if (cachedSafeBottom < 0) {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--sab');
    cachedSafeBottom = parseInt(v) || 0;
  }
  return cachedSafeBottom;
}
