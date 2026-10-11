// 一時的な演出（爆風・薙ぎ払い・ダメージ数字など）。sim のイベントから生成。
import { teamColor } from '../config/settings';
import type { Team } from '../config/types';
import type { GameEvent } from '../sim/world';
import type { Camera } from './camera';

interface Fx {
  kind: 'ring' | 'sweep' | 'num' | 'text' | 'spark';
  x: number;
  y: number;
  r: number;
  t: number;
  T: number;
  color: string;
  text?: string;
  dx?: number;
  dy?: number;
  size?: number;
}

const MAX_FX = 260;

export class Effects {
  list: Fx[] = [];
  viewTeam: Team = 0;

  push(events: GameEvent[], camera: Camera, playerId: number) {
    for (const e of events) {
      switch (e.type) {
        case 'blast':
          this.add({ kind: 'ring', x: e.x, y: e.y, r: e.r, t: 0, T: 0.35, color: teamColor(e.team) });
          break;
        case 'sweep':
          this.add({ kind: 'sweep', x: e.x, y: e.y, r: 110, t: 0, T: 0.2, color: '#fff', dx: e.dx, dy: e.dy });
          break;
        case 'ram':
          this.add({ kind: 'spark', x: e.x, y: e.y, r: 40, t: 0, T: 0.3, color: '#ffd23f' });
          break;
        case 'damage': {
          const mine = e.team === this.viewTeam;
          this.add({
            kind: 'num',
            x: e.x + (Math.random() * 20 - 10),
            y: e.y,
            r: 0,
            t: 0,
            T: 0.75,
            color: e.big ? '#ffd23f' : mine ? '#ffffff' : '#ff8080',
            text: String(Math.round(e.amount)),
            size: e.big ? 30 : e.amount >= 60 ? 26 : 20,
          });
          break;
        }
        case 'baseDestroyed':
          this.add({ kind: 'ring', x: e.base.x, y: e.base.y, r: 260, t: 0, T: 0.8, color: '#ffd23f' });
          camera.addShake(14);
          break;
        case 'heroKilled':
          this.add({ kind: 'ring', x: e.hero.x, y: e.hero.y, r: 120, t: 0, T: 0.5, color: '#fff' });
          if (e.hero.id === playerId) camera.addShake(10);
          break;
        case 'chain':
          this.add({
            kind: 'text',
            x: e.hero.x,
            y: e.hero.y - 70,
            r: 0,
            t: 0,
            T: 1.3,
            color: '#7cf0ff',
            text: `${e.count} CHAIN! +${e.xp.toFixed(1)}XP`,
            size: 26,
          });
          break;
        default:
          break;
      }
    }
  }

  add(f: Fx) {
    if (this.list.length >= MAX_FX) this.list.shift();
    this.list.push(f);
  }

  update(dt: number) {
    for (const f of this.list) f.t += dt;
    this.list = this.list.filter((f) => f.t < f.T);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const f of this.list) {
      const k = f.t / f.T;
      ctx.globalAlpha = 1 - k;
      switch (f.kind) {
        case 'ring':
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 8 * (1 - k) + 2;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = f.color;
          ctx.globalAlpha = (1 - k) * 0.25;
          ctx.fill();
          break;
        case 'sweep': {
          const a = Math.atan2(f.dy!, f.dx!);
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * (0.6 + 0.4 * k), a - 1, a + 1);
          ctx.stroke();
          break;
        }
        case 'spark':
          ctx.fillStyle = f.color;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(f.x + Math.cos(a) * f.r * k, f.y + Math.sin(a) * f.r * k, 5, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case 'num':
        case 'text':
          ctx.font = `900 ${f.size}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 5;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.strokeText(f.text!, f.x, f.y - 40 * k);
          ctx.fillStyle = f.color;
          ctx.fillText(f.text!, f.x, f.y - 40 * k);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}
