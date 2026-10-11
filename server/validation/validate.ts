// サーバー側の入力検証（SPEC 8.3 チート対策）。
// クライアントは入力しか送らない。位置・HP・MP・CD はすべてサーバーが計算する。
import { WORLD_H, WORLD_W } from '../../shared/config/map';
import { NET, actionOf, type InputCmd } from '../../shared/net/protocol';
import type { Vec } from '../../shared/sim/geom';
import { pathLength, truncatePath } from '../../shared/sim/projectiles/drawshot';
import type { Command, Hero } from '../../shared/sim/units/hero';
import { skillReady, wonderReady } from '../../shared/sim/effects';

export type RejectReason = 'stale' | 'multi' | 'rate' | 'mp' | 'cd' | 'speed' | 'malformed' | 'dead';

export interface ValidationResult {
  move: { x: number; y: number };
  cmd?: Command;
  reject?: RejectReason;
  /** 描線を切り詰めた（拒否ではなくクランプして発動） */
  clamped?: boolean;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampW = (x: number, y: number): Vec => ({ x: Math.max(0, Math.min(WORLD_W, x)), y: Math.max(0, Math.min(WORLD_H, y)) });

export interface ValidationCtx {
  /** 直前に処理した seq（これ以下は再送・リプレイとして無視） */
  lastSeq: number;
  /** この tick で既に発動を処理したか（1 tick に複数発動させない） */
  actedThisTick: boolean;
  /** ラグ補償に使う推定遅延（ms） */
  lagMs: number;
}

export function validateInput(cmd: InputCmd, hero: Hero, ctx: ValidationCtx): ValidationResult {
  // 移動：正規化（速度ハック対策。1 tick の移動量はサーバーが速度から計算するので、ここでは向きと強さだけ）
  let mx = finite(cmd.move?.x) ? cmd.move.x : 0;
  let my = finite(cmd.move?.y) ? cmd.move.y : 0;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  const move = { x: mx, y: my };
  if (!finite(cmd.seq) || cmd.seq <= ctx.lastSeq) return { move, reject: 'stale' };

  const act = actionOf(finite(cmd.buttons) ? cmd.buttons : 0);
  if (act === 'none') return { move };
  if (act === null) return { move, reject: 'multi' };
  if (ctx.actedThisTick) return { move, reject: 'rate' };
  if (!hero.alive) return { move, reject: 'dead' };

  const aim = cmd.aim && finite(cmd.aim.x) && finite(cmd.aim.y) ? clampW(cmd.aim.x, cmd.aim.y) : null;
  switch (act) {
    case 'SS':
      if (!aim) return { move, reject: 'malformed' };
      if (hero.ssCd > 0) return { move, reject: 'cd' };
      return { move, cmd: { t: 'ss', x: aim.x, y: aim.y } };
    case 'EVADE': {
      const d = cmd.dir && finite(cmd.dir.x) && finite(cmd.dir.y) ? cmd.dir : { x: 0, y: 0 };
      if (hero.evadeCd > 0) return { move, reject: 'cd' };
      return { move, cmd: { t: 'evade', dx: d.x, dy: d.y } };
    }
    case 'CARD': {
      const slot = cmd.card;
      if (!finite(slot) || slot < 0 || slot > 2 || !aim) return { move, reject: 'malformed' };
      const r = skillReady(hero, slot);
      if (!r.ok) return { move, reject: r.reason === 'mp' ? 'mp' : 'cd' };
      return { move, cmd: { t: 'skill', slot, x: aim.x, y: aim.y } };
    }
    case 'WS':
      if (!aim) return { move, reject: 'malformed' };
      if (!wonderReady(hero)) return { move, reject: 'cd' };
      return { move, cmd: { t: 'ws', x: aim.x, y: aim.y } };
    case 'DS': {
      const d = cmd.draw;
      if (!d || !Array.isArray(d.points) || d.points.length < 4 || d.points.length % 2 !== 0) return { move, reject: 'malformed' };
      if (hero.mp < hero.drawCost) {
        hero.say('MP不足');
        return { move, reject: 'mp' };
      }
      let pts: Vec[] = [];
      for (let i = 0; i + 1 < d.points.length; i += 2) {
        const x = d.points[i];
        const y = d.points[i + 1];
        if (!finite(x) || !finite(y)) return { move, reject: 'malformed' };
        pts.push(clampW(x, y));
      }
      // 制御点が多すぎるものは間引く
      if (pts.length > NET.maxDrawPoints) {
        const step = pts.length / NET.maxDrawPoints;
        const out: Vec[] = [];
        for (let i = 0; i < NET.maxDrawPoints; i++) out.push(pts[Math.floor(i * step)]);
        out.push(pts[pts.length - 1]);
        pts = out;
      }
      const L = pathLength(pts);
      const dur = finite(d.durMs) ? Math.max(0, d.durMs) : 0;
      // 描画速度：物理的に不可能な速さ（一瞬で長い線）を弾く
      if (L > 120 && L / Math.max(1, dur) > NET.maxDrawPxPerMs) return { move, reject: 'speed' };
      // 描線長：上限を超えた分は拒否ではなく切り詰めて発動（クランプ）
      let clamped = false;
      const def = hero.def.draw;
      if (def.type === 'curve' && def.drawLength > 0 && L > def.drawLength) {
        pts = truncatePath(pts, def.drawLength);
        clamped = true;
      }
      return { move, cmd: { t: 'ds', pts, lagMs: ctx.lagMs }, clamped };
    }
  }
  return { move };
}
