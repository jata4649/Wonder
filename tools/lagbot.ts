// ラグ補償の実ネットワーク検証用ボット：協力モードで入室し、見えている敵キャストへ描線を撃ち続ける。
//   npx tsx tools/lagbot.ts ws://localhost:8788/ws 60
import WebSocket from 'ws';
import { NetMirror } from '../shared/net/mirror';
import { BTN, type InputCmd, type ServerMsg, type WelcomeMsg } from '../shared/net/protocol';
import { CASTER_BY_ID } from '../shared/config/casters';

const url = process.argv[2] ?? 'ws://localhost:8787/ws';
const seconds = Number(process.argv[3] ?? 60);
const ws = new WebSocket(url);
let mirror: NetMirror | undefined;
let offset = 0;
let seq = 0;
let shots = 0;
const lo = { casterId: 'kurousagi', skillIds: CASTER_BY_ID.kurousagi.skills.slice(0, 3).map((s) => s.id), assistIds: [], soulId: '' };
ws.on('open', () => {
  ws.send(JSON.stringify({ k: 'hello', name: 'bot', token: `bot${Date.now()}`, mode: 'coop', loadout: lo, difficulty: 'easy' }));
  setInterval(() => ws.send(JSON.stringify({ k: 'ping', t: performance.now() })), 1000);
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString()) as ServerMsg;
  if (m.k === 'welcome') {
    const w = m as WelcomeMsg;
    mirror = new NetMirror(w.seed, w.roster, w.heroId, w.team, false);
  } else if (m.k === 'snap' && mirror) mirror.apply(m);
  else if (m.k === 'pong') offset = m.st + (performance.now() - m.t) / 2 - performance.now();
});
let lastShot = 0;
const loop = setInterval(() => {
  if (!mirror?.me) return;
  mirror.interpolate(performance.now() + offset, 1 / 30);
  const me = mirror.me;
  const enemies = mirror.world.heroes.filter((h) => h.team !== me.team && h.alive && Math.hypot(h.x - me.x, h.y - me.y) < 280);
  let move = { x: 0, y: -1 };
  const cmd: InputCmd = { seq: ++seq, t: performance.now(), move, buttons: 0 };
  if (me.hp < me.maxHp * 0.35) move = { x: 0, y: 1 };
  if (enemies.length) {
    move = { x: 0, y: 0 };
    const e = enemies[0];
    if (performance.now() - lastShot > 700 && me.mp >= 10) {
      // 見えている位置（補間で100ms遅れ＋片道遅延）を貫く直線
      const dx = e.x - me.x;
      const dy = e.y - me.y;
      const L = Math.hypot(dx, dy) || 1;
      const sx = me.x + (dx / L) * 50;
      const sy = me.y + (dy / L) * 50;
      cmd.buttons = BTN.DS;
      cmd.draw = { points: [sx, sy, e.x, e.y, e.x + (dx / L) * 80, e.y + (dy / L) * 80].map(Math.round), durMs: 250 };
      lastShot = performance.now();
      shots++;
    }
  }
  cmd.move = move;
  mirror.predict(cmd);
  ws.send(JSON.stringify({ k: 'input', cmd: mirror.toServer(cmd) }));
}, 1000 / 30);
setTimeout(() => {
  clearInterval(loop);
  console.log(JSON.stringify({ shots, err: Math.round(mirror?.lastError ?? -1) }));
  process.exit(0);
}, seconds * 1000);
