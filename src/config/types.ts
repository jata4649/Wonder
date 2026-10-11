// データモデル（SPEC.md Section 5）。シミュレーションと描画の両方から参照する。

export type Role = 'fighter' | 'attacker' | 'support';
export type Team = 0 | 1; // 0 = 自軍(既定:赤・下), 1 = 敵軍(既定:青・上)
export type DSType = 'curve' | 'leap' | 'charge' | 'lob';
export type LaneId = 0 | 1 | 2; // 0=左, 1=中央, 2=右

export interface DrawShotDef {
  type: DSType;
  mpCost: number; // 基本 10
  range: number; // ドロー射程（描ける円の半径, px）
  drawLength: number; // 描ける線の長さ（px）
  baseSpeed: number; // 弾速 (px/s)
  speedUpStraight: number; // 直線/緩カーブ時の加速係数(1.0=変化なし) ※100px 直進ごとの倍率
  speedDownSharp: number; // 鋭角時の減速係数(<1.0 ほど減速) ※90°曲げるごとの倍率
  width: number; // 弾サイズ/判定幅
  power: number; // 表記威力（1ヒット目）
  decay: number[]; // ヒット毎の係数（ロール既定＋個別上書き）
  piercePower: number; // 貫通力（大兵士耐性1 / 巨人5）
  pierceDecay: boolean; // 貫通時に威力が減衰するか（false=減衰なし）
  maxHits: number; // 最大ヒット数(0=無制限)
  down: boolean; // ヒット時にダウンさせるか
  multiShot: number; // 同時発射弾数
  soloCross: boolean; // 自分の前回軌跡でクロス可
  lobRadius?: number; // 投擲型の着弾範囲半径
  lobTime?: number; // 投擲型の着弾までの時間
  coreMult?: number; // 拠点・城への倍率
  aoeRadius?: number; // 跳躍/突撃の攻撃判定半径
}

export type SkillKind = 'attack' | 'buff' | 'debuff' | 'heal' | 'mobility';

export interface SkillDef {
  id: string;
  name: string;
  glyph: string;
  kind: SkillKind;
  mpCost: number;
  cooldown: number;
  requiredLevel: number;
  // 効果は関数IDで参照し、sim/effects.ts の実装と対応させる
  effect: string;
  params: Record<string, number>;
  desc?: string;
}

export interface StraightDef {
  power: number;
  speed: number;
  pierce: boolean;
  trait?: 'sweep' | 'blast' | 'triple';
  traitPower?: number; // 特性部分の威力
  minionMult?: number; // 対兵士倍率
  heroMult?: number; // 対キャスト倍率
}

export interface CasterDef {
  id: string;
  name: string;
  role: Role;
  maxHp: number;
  maxMp: number;
  mpRegen: number;
  moveSpeed: number;
  straightRange: number;
  straight: StraightDef;
  draw: DrawShotDef;
  skills: SkillDef[]; // 5つ持たせ、3つを装備
  wonderSkill: SkillDef; // 1試合1回・MP0
  color: string;
  accent: string;
  glyph: string;
  desc: string;
}

export type StatKey =
  | 'straightAtk'
  | 'drawAtk'
  | 'maxHp'
  | 'maxMp'
  | 'speed'
  | 'piercePower'
  | 'drawRange'
  | 'xpRange';

export interface AssistDef {
  id: string;
  name: string;
  slot: 'weapon' | 'armor' | 'tool' | 'accessory' | 'soul';
  requiredLevel: number;
  mods: Partial<Record<StatKey, number>>;
  desc?: string;
}

export type GiantType = 'breaker' | 'whirl' | 'support';

export interface SoulDef {
  id: string;
  name: string;
  giantType: GiantType;
  mods?: Partial<Record<StatKey, number>>;
  desc?: string;
}

export interface GiantDef {
  type: GiantType;
  name: string;
  maxHp: number;
  moveSpeed: number;
  atk: number;
  canAttackUnits: boolean;
  destroysBaseOnContact: boolean;
  radius: number;
  attackRange: number;
  attackInterval: number;
  healPerSec?: number;
  auraRadius?: number;
  glyph: string;
}

export type BaseKind = 'small' | 'normal' | 'large' | 'huge' | 'castle';
export type GateKind = 'none' | 'setsuna' | 'yukyu';

export interface BaseDef {
  kind: BaseKind;
  maxHp: number;
  gaugeDamage: number; // 破壊時のチームゲージ減少量
  gaugeOnFullDamage: number; // 耐久をすべて削ったときに累計で減るゲージ量
  gate: GateKind; // 破壊後に開く門（手前拠点のみ）
  radius: number;
}

export interface Loadout {
  casterId: string;
  skillIds: string[]; // 3つ
  assistIds: string[]; // 最大4つ（4枠目はLv6以上で発動）
  soulId: string;
}

export type Difficulty = 'easy' | 'normal' | 'hard';
