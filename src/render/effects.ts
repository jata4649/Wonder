// 一時的な演出（爆風・薙ぎ払い・ダメージ数字など）。sim のイベントから生成。
import { teamColor } from '../config/settings';
import type { Team } from '../config/types';
import type { GameEvent } from '../sim/world';
import type { Camera } from './camera';

interface Fx {
  kind: 'ring' | 'sweep' | 'num' | 'text' | 'spark' | 'banner';
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
          if (e.targetId === playerId && e.amount >= 35) camera.addShake(Math.min(10, e.amount / 10));
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
        case 'baseDestroyed': {
          this.add({ kind: 'ring', x: e.base.x, y: e.base.y, r: 260, t: 0, T: 0.8, color: '#ffd23f' });
          camera.addShake(14);
          const lane = ['左', '中央', '右'][e.base.lane as number] ?? '';
          const own = e.base.team === this.viewTeam;
          this.banner(`${own ? '自軍' : '敵軍'}${lane}${e.base.tier === 'front' ? '手前' : '奥'}拠点 陥落`, own ? '#ff8080' : '#ffd23f');
          break;
        }
        case 'gateOpen': {
          const own = e.base.team === this.viewTeam;
          const lane = ['左', '中央', '右'][e.base.lane as number] ?? '';
          this.banner(`${own ? '自軍' : '敵軍'}${lane}の${e.base.gate?.kind === 'yukyu' ? '悠久門' : '刹那門'}が開いた`, '#cfe3ff');
          break;
        }
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
        case 'levelUp':
          if (e.team === this.viewTeam) {
            this.add({ kind: 'banner', x: 0, y: 0, r: 0, t: 0, T: 1.6, color: '#ffd23f', text: `チームレベル ${e.level}!`, size: 30 });
          }
          break;
        case 'cross':
          this.add({ kind: 'text', x: e.x, y: e.y - 40, r: 0, t: 0, T: 1, color: '#ffd23f', text: e.solo ? '単独CROSS!' : 'CROSS!', size: 28 });
          this.add({ kind: 'ring', x: e.x, y: e.y, r: 90, t: 0, T: 0.5, color: '#ffd23f' });
          break;
        case 'soulAnnounce':
          if (e.team === this.viewTeam) this.banner(`ソウル予告：${e.soul.name}（${['左', '中央', '右'][e.lane]}レーン）`, '#d9b3ff');
          break;
        case 'giantSummon': {
          const own = e.giant.team === this.viewTeam;
          this.banner(`${own ? '自軍' : '敵軍'}の巨人「${e.giant.def.name}」召喚！`, own ? '#ffd23f' : '#ff8080', 2.4);
          this.add({ kind: 'ring', x: e.giant.x, y: e.giant.y, r: 300, t: 0, T: 1.2, color: '#d9b3ff' });
          camera.addShake(12);
          break;
        }
        case 'giantKilled':
          this.banner(`${e.giant.team === this.viewTeam ? '自軍' : '敵軍'}の巨人が倒れた`, '#ffffff');
          this.add({ kind: 'ring', x: e.giant.x, y: e.giant.y, r: 220, t: 0, T: 0.8, color: '#fff' });
          break;
        case 'heal':
          this.add({ kind: 'num', x: e.x, y: e.y - 30, r: 0, t: 0, T: 0.8, color: '#7CFC8A', text: `+${Math.round(e.amount)}`, size: 22 });
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

  /** 画面座標で描く告知（バナー）。 */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number) {
    let row = 0;
    for (const f of this.list) {
      if (f.kind !== 'banner') continue;
      const k = f.t / f.T;
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
      const y = h * 0.24 + row * 46;
      ctx.font = `900 ${f.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(f.text!).width + 40;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(w / 2 - tw / 2, y - 22, tw, 44);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text!, w / 2, y);
      row++;
    }
    ctx.globalAlpha = 1;
  }

  banner(text: string, color = '#fff', T = 1.8) {
    this.add({ kind: 'banner', x: 0, y: 0, r: 0, t: 0, T, color, text, size: 26 });
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const f of this.list) {
      if (f.kind === 'banner') continue;
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
