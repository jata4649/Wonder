// 1ルームの負荷：8人（全員に毎回スナップショットを作る）＋兵士150体＋巨人。tick の処理時間を測る。
import { deflateRawSync } from 'node:zlib';
import { GameRoom, type Conn } from '../server/rooms/GameRoom';
import { spawnSquad } from '../shared/sim/minions';
import { CASTER_BY_ID } from '../shared/config/casters';
let bytes = 0;
let zbytes = 0;
const mk = (i: number): Conn => ({ id: `c${i}`, send: (m) => { const j = JSON.stringify(m); if (i === 0) { bytes += j.length; zbytes += deflateRawSync(j, { level: 3 }).length; } } });
const ids = ['akazukin', 'tetsukagi', 'nemurihime', 'kurousagi', 'garasunokutsu', 'hoshitsubame', 'onryou', 'shichinin'];
const players = ids.map((id, i) => ({ token: `t${i}`, name: `P${i}`, loadout: { casterId: id, skillIds: CASTER_BY_ID[id].skills.slice(0, 3).map((s) => s.id), assistIds: [], soulId: '' }, team: (i % 2) as 0 | 1, conn: mk(i), mmr: 1500 }));
const room = new GameRoom({ id: 'L', mode: 'quick', difficulty: 'normal', players });
// 人間枠も AI に動かしてもらう（負荷を実戦に近づける）
for (const s of room.seats) room.director.attach(s.hero, 'hard');
for (const team of [0, 1] as const) for (const lane of [0, 1, 2] as const) {
  room.world.summonGiant(team, lane, { id: `g${team}${lane}`, name: 'g', giantType: (['breaker', 'whirl', 'support'] as const)[lane] });
  for (let k = 0; k < 3; k++) spawnSquad(room.world, team, lane, 'castle', 9, 1, 600 + lane * 600, team === 0 ? 2200 + k * 120 : 1400 - k * 120);
}
room.world.freezeT = 0;
const N = 900; // 30秒
const times: number[] = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  room.step();
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / N;
console.log(JSON.stringify({ minions: room.world.minions.length, giants: room.world.giants.length, avgMs: +avg.toFixed(2), p95Ms: +times[Math.floor(N * 0.95)].toFixed(2), maxMs: +times[N - 1].toFixed(2), budgetMs: +(1000 / 30).toFixed(1), kbpsPerClient: +((bytes * 8) / 30 / 1000).toFixed(1), kbpsPerClientDeflate: +((zbytes * 8) / 30 / 1000).toFixed(1) }));
