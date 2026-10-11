// 試合のセットアップ：4対4（プレイヤー＋味方AI3、敵AI4）。プレイヤー無しなら8体すべてAI。
import { ASSISTS, SOULS } from '../config/assists';
import { CASTERS, CASTER_BY_ID } from '../config/casters';
import { nearestLane } from '../config/map';
import type { Difficulty, LaneId, Loadout, Team } from '../config/types';
import type { Rng } from '../sim/geom';
import type { Hero } from '../sim/units/hero';
import type { World } from '../sim/world';
import { HeroAI } from './heroAI';
import { assignLanes } from './laneAssign';

export function randomLoadout(rng: Rng, casterId: string): Loadout {
  const c = CASTER_BY_ID[casterId];
  const skills = [...c.skills];
  // 低レベル解禁のものを中心に3つ
  const picked = [skills[0], skills[1], rng.pick(skills.slice(2))];
  const pool = [...ASSISTS];
  const assistIds: string[] = [];
  while (assistIds.length < 4 && pool.length) assistIds.push(pool.splice(rng.int(0, pool.length), 1)[0].id);
  return { casterId, skillIds: picked.map((s) => s.id), assistIds, soulId: rng.pick(SOULS).id };
}

function pickTeam(rng: Rng, n: number, exclude: string[]): string[] {
  const pool = CASTERS.map((c) => c.id).filter((id) => !exclude.includes(id));
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(rng.int(0, pool.length), 1)[0]);
  return out;
}

export class AIDirector {
  ais: HeroAI[] = [];
  private reassignT = 0;

  constructor(
    private world: World,
    private player: Hero | undefined,
  ) {}

  update(dt: number) {
    this.handlePings();
    this.reassignT -= dt;
    if (this.reassignT <= 0) {
      this.reassignT = 12;
      this.reassign();
    }
    for (const ai of this.ais) ai.update(dt);
  }

  private seenPings = new Set<string>();
  /** プレイヤーのピングに味方AIが反応する。 */
  private handlePings() {
    for (const p of this.world.pings) {
      const key = `${p.team}:${p.kind}:${Math.round(p.x)}:${Math.round(p.y)}`;
      if (this.seenPings.has(key)) continue;
      this.seenPings.add(key);
      const allies = this.ais.filter((a) => a.hero.team === p.team && a.hero.alive);
      if (p.kind === 'gather') {
        // 近い味方2人がピングのレーンへ
        const lane = nearestLane(p.x) as LaneId;
        allies
          .sort((a, b) => Math.hypot(a.hero.x - p.x, a.hero.y - p.y) - Math.hypot(b.hero.x - p.x, b.hero.y - p.y))
          .slice(0, 2)
          .forEach((a) => a.focusLane(lane, 15));
      } else if (p.kind === 'retreat') {
        for (const a of allies) if (Math.hypot(a.hero.x - p.x, a.hero.y - p.y) < 1200 && a.hero.hp / a.hero.maxHp < 0.75) a.mode = 'retreat';
      }
    }
    if (this.seenPings.size > 200) this.seenPings.clear();
  }

  /** レーン割り当て（プレイヤーのいるレーンは固定として扱う）。 */
  reassign() {
    for (const team of [0, 1] as Team[]) {
      const members = this.world.heroes.filter((h) => h.team === team);
      const input = members.map((h) => ({
        id: h.id,
        role: h.def.role,
        fixedLane: h === this.player ? (nearestLane(h.x) as LaneId) : undefined,
      }));
      const asg = assignLanes(input);
      for (const ai of this.ais) {
        const a = asg.get(ai.hero.id);
        if (a && ai.hero.team === team && !ai.focusing) {
          ai.lane = a.lane;
          ai.roam = a.roam;
          ai.hero.lane = a.lane;
        }
      }
    }
  }
}

export function setupMatch(
  world: World,
  playerLoadout: Loadout | null,
  difficulty: Difficulty,
): { player?: Hero; director: AIDirector } {
  const rng = world.rng;
  let player: Hero | undefined;
  const allyIds = playerLoadout ? pickTeam(rng, 3, [playerLoadout.casterId]) : pickTeam(rng, 4, []);
  const enemyIds = pickTeam(rng, 4, []);
  if (playerLoadout) player = world.addHero(playerLoadout, 0, true, 1);
  const director = new AIDirector(world, player);
  for (const [team, ids] of [
    [0, allyIds],
    [1, enemyIds],
  ] as [Team, string[]][]) {
    for (const id of ids) {
      const h = world.addHero(randomLoadout(rng, id), team, false, 1);
      // 味方AIはプレイヤーと同じ難易度ロジック（味方は常に「ふつう」以上の賢さ）
      const diff: Difficulty = team === 0 && difficulty === 'easy' ? 'normal' : difficulty;
      director.ais.push(new HeroAI(world, h, diff, 1));
    }
  }
  director.reassign();
  world.controllers.push(director);
  return { player, director };
}
