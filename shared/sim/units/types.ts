import type { LaneId, Team } from '../../config/types';

/** 動くユニット共通（兵士・キャスト・巨人）。 */
export interface Mob {
  id: number;
  kind: 'minion' | 'hero' | 'giant';
  team: Team;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** ダウン（転倒）残り秒数。ダウン中は行動不能。 */
  downTimer: number;
  /** 貫通耐性（小兵士/キャスト=0, 大兵士=1, 巨人=5）。 */
  pierceResist: number;
  /** 被弾演出 */
  hitFlash: number;
  /** 攻撃などで森の中でも一時的に見える残り秒数 */
  revealTimer: number;
  /** 鈍足（兵士・巨人用。キャストはバフで管理） */
  slowT: number;
  slowMult: number;
}

export type SquadSource = 'castle' | 'front' | 'deep';
export type SquadState = 'form' | 'advance' | 'fight' | 'ram' | 'wait';

export interface Minion extends Mob {
  kind: 'minion';
  big: boolean;
  squad: Squad;
  slot: number;
  atkTimer: number;
  ramming: boolean;
  speed: number;
  atk: number;
  ramDamage: number;
  xp: number;
  /** 最後にダメージを与えたチーム（経験値の行き先） */
  lastHitTeam: Team | -1;
}

export interface Squad {
  id: number;
  team: Team;
  lane: LaneId;
  source: SquadSource;
  members: Minion[];
  ax: number; // 隊列の基準点
  ay: number;
  formTimer: number;
  state: SquadState;
  speed: number;
}
