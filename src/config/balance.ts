// 数値はすべてここに集約する（たたき台）。ここを書き換えるだけで調整できるようにする。
import type { BaseDef, BaseKind, Difficulty, GateKind, Role } from './types';

export const MATCH = {
  durationSec: 420, // 7分
  teamGaugeMax: 100,
  teamSize: 4,
  /** 陣営カラー。原作準拠で既定は自軍＝赤。settings で反転可能。 */
  teamColors: { red: '#e5484d', blue: '#3e7bfa' },
  fixedDt: 1 / 60,
};

/** 拠点。破壊時のゲージ減少量は 通常=10 を基準に 小≈0.6倍 / 特大≈2.2倍。 */
export const BASES: Record<BaseKind, BaseDef> = {
  small: { kind: 'small', maxHp: 1000, gaugeDamage: 6, gaugeOnFullDamage: 3, gate: 'yukyu', radius: 70 },
  normal: { kind: 'normal', maxHp: 1500, gaugeDamage: 10, gaugeOnFullDamage: 5, gate: 'setsuna', radius: 80 },
  large: { kind: 'large', maxHp: 2100, gaugeDamage: 15, gaugeOnFullDamage: 6, gate: 'none', radius: 92 },
  huge: { kind: 'huge', maxHp: 2800, gaugeDamage: 22, gaugeOnFullDamage: 8, gate: 'none', radius: 104 },
  // 城は壊れない。受けたダメージ量がそのままゲージ減少になる。
  castle: { kind: 'castle', maxHp: 99999, gaugeDamage: 0, gaugeOnFullDamage: 0, gate: 'none', radius: 120 },
};

/** 城へのダメージ 1 あたりのゲージ減少量。 */
export const CASTLE_GAUGE_PER_DMG = 0.0045;

/** 門が開くまでの秒数（手前拠点が壊れてから）。 */
export const GATE_OPEN_SEC: Record<GateKind, number> = { none: 0, setsuna: 12, yukyu: 65 };

/** チームゲージ：キャスト撃破時の減少量（拠点破壊 > 拠点/城ダメージ > 撃破 の序列）。 */
export const GAUGE = {
  heroKill: 2.5,
};

export const MINION = {
  small: { hp: 70, atk: 7, ramDamage: 70, radius: 15, xp: 1, speed: 72 },
  big: { hp: 260, atk: 14, ramDamage: 210, radius: 22, xp: 3, speed: 66 },
  pierceResistBig: 1,
  recognizeRange: 270,
  attackRange: 230,
  attackInterval: 1.25,
  boltSpeed: 420,
  formSec: 2.0, // 整列時間（この間は無敵）
  ramRange: 190, // 拠点までこの距離に入ったら突撃
  ramSpeed: 190,
  spacing: 34,
  // 出撃
  castleWave: { count: 9, big: 1, intervalSec: 40, firstAt: 4 },
  frontWave: { count: 4, firstCount: 8, intervalSec: 40, firstAt: 2, offsetSec: 20 },
  deepWave: { countOnOpen: 6, count: 5, intervalSec: 40 },
  downSec: 1.0,
  downChaseMult: 0.5, // ダウン追撃時の威力倍率
  maxTotal: 150, // 画面負荷対策：総数の上限（超えたら古い個体から間引く）
};

/** ロール別のドロー減衰（軌道弾）。ファイター≈最終6割、それ以外≈4〜5割。 */
export const ROLE_DECAY: Record<Role, number[]> = {
  fighter: [1, 0.92, 0.84, 0.76, 0.7, 0.65, 0.6],
  attacker: [1, 0.85, 0.72, 0.62, 0.54, 0.48, 0.45],
  support: [1, 0.86, 0.74, 0.64, 0.56, 0.5, 0.46],
};

export const HERO = {
  radius: 26,
  respawnBase: 6,
  respawnPerLevel: 0.8,
  ssCooldown: 0.42,
  evade: { distance: 210, duration: 0.24, invuln: 0.32, cooldown: 1.4 },
  downSec: 0.6,
  castleRegenHpPerSec: 0.18, // 自城付近で最大HPの割合回復
  castleRegenRadius: 420,
  mpRegenCastleMult: 4,
  /** ドローの始点は自キャストからこの距離までずらせる（判定内）。 */
  drawStartRadius: 70,
  /** 自キャストの上で離したらキャンセル（この距離以内）。 */
  cancelRadius: 46,
  levelHpPerLv: 0.06,
  levelAtkPerLv: 0.05,
};

/** 曲線の解析に使う定数（弾速変化）。 */
export const DRAW_PHYS = {
  resampleStep: 8,
  sharpPerStep: 0.07, // 1ステップ(8px)あたりこれ以上曲がると「鋭角」扱い
  minSpeedFrac: 0.03, // 停滞ドローの下限（基礎弾速に対する割合）
  maxSpeedFrac: 2.2,
  minLifetime: 0.25,
  maxLifetime: 6, // 停滞しても最大この秒数で消える
};

export const CHAIN = {
  bonusAt: 5,
  bonusXp: 1.8, // 小兵士1.8体分
  extraPerHit: 0.25, // 本作独自：5を超えた分だけ増える
};

export const XP = {
  orbLifeSec: 15,
  pickupMagnetSpeed: 900,
  heroXp: 6,
  giantXp: 20,
  /** チームレベル到達に必要な累計経験値。index=レベル-1。 */
  levelThresholds: [0, 15, 38, 68, 105, 150, 200, 260, 330, 410],
  maxLevel: 10,
  assistLv4Slot: 6, // アシスト4枠目はLv6以上
  wonderSkillLevel: 5,
};

export const SOUL = {
  max: 100,
  tickSec: 6.5,
  tickGain: 3.5,
  diffStep: 25, // 25%刻み
  trailerBonusPerStep: 0.6,
  eventBase: { baseLost: 8, heroLost: 4 },
  leaderEventMult: 0.5,
  giantAliveMult: 0.2,
  announceAt: 50,
  freezeSec: 1.2,
};

export const SKILL_COMMON = {
  globalCooldown: 0.3,
};

export const AI_DIFFICULTY: Record<
  Difficulty,
  { reaction: number; aimError: number; dsRate: number; dodgeLob: number; skillRate: number; retreatHp: number }
> = {
  easy: { reaction: 0.75, aimError: 70, dsRate: 0.35, dodgeLob: 0.15, skillRate: 0.3, retreatHp: 0.3 },
  normal: { reaction: 0.45, aimError: 35, dsRate: 0.65, dodgeLob: 0.5, skillRate: 0.6, retreatHp: 0.3 },
  hard: { reaction: 0.22, aimError: 12, dsRate: 0.95, dodgeLob: 0.85, skillRate: 0.9, retreatHp: 0.3 },
};

export const CROSS = {
  trailLifeSec: 20,
  sizeMult: 1.45,
  powerAdd: 0.28,
  speedMult: 1.2,
};

export const CAMERA = {
  viewWorldMin: 900, // 縦画面：画面短辺に映る世界の幅
  landSideMargin: 20, // 横画面：フィールド幅＝画面幅にするときの左右の余白（世界px）
};

/** 縦送りカメラ（SPEC 1.5）。カメラ位置 = 自キャストの足元 + オフセット(yのみ)。 */
export const CAM = {
  followLerp: 0.14, // 追従の滑らかさ（60fps 1フレームあたり。1に近いほど即追従）
  panClamp: 0.34, // オフセットの上限＝画面高の何割まで見られるか（上下それぞれ）
  minOnScreen: 0.15, // 自キャストが画面端から最低これだけ内側に残るよう追加でクランプ
  resetMs: 150, // リセットの戻りイージング
  autoReturnMs: 0, // 0＝自動復帰しない（リセットボタンで戻す）。>0 で放置復帰
};
