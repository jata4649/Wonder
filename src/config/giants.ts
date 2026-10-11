// 巨人（ソウル召喚）。オリジナル名。
import type { GiantDef, GiantType } from './types';

export const GIANTS: Record<GiantType, GiantDef> = {
  // 猛突進：目の前の何も無視して一直線に拠点へ。触れた拠点を耐久に関係なく破壊する非攻撃型。
  breaker: {
    type: 'breaker',
    name: '猛突の巨牛',
    maxHp: 2300,
    moveSpeed: 88,
    atk: 0,
    canAttackUnits: false,
    destroysBaseOnContact: true,
    radius: 58,
    attackRange: 0,
    attackInterval: 0,
    glyph: '牛',
  },
  // 暴旋風：近接範囲攻撃で兵士列を一撃で薙ぎ払う。
  whirl: {
    type: 'whirl',
    name: '暴風の巨人',
    maxHp: 2900,
    moveSpeed: 72,
    atk: 95,
    canAttackUnits: true,
    destroysBaseOnContact: false,
    radius: 62,
    attackRange: 190,
    attackInterval: 1.6,
    glyph: '嵐',
  },
  // 支援：周囲の味方を回復し、敵を鈍らせながら敵拠点へ向かう。
  support: {
    type: 'support',
    name: '慈雨の大樹',
    maxHp: 2600,
    moveSpeed: 70,
    atk: 60,
    canAttackUnits: false,
    destroysBaseOnContact: false,
    radius: 60,
    attackRange: 0,
    attackInterval: 1.4,
    healPerSec: 14,
    auraRadius: 280,
    glyph: '樹',
  },
};

/** 城に到達した猛突進巨人が与えるダメージ。 */
export const GIANT_CASTLE_HIT = 1800;
/** 巨人の基礎ダメージ倍率（対拠点）。 */
export const GIANT_BASE_MULT = 2.5;
/** ダウン：短時間のみ、その後しばらく無効。 */
export const GIANT_DOWN = { sec: 0.5, immune: 3 };
