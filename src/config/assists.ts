// アシストカード・ソウル（オリジナル）。チームレベルが requiredLevel に達すると効果が発動する。
// mods の単位: maxHp/maxMp/piercePower=加算, speed/straightAtk/drawAtk/drawRange/xpRange=割合(0.1=+10%)
import type { AssistDef, SoulDef } from './types';

export const ASSISTS: AssistDef[] = [
  { id: 'as_woodsword', name: '樫の木剣', slot: 'weapon', requiredLevel: 1, mods: { drawAtk: 0.07 }, desc: 'ドロー攻撃+7%' },
  { id: 'as_steelsword', name: '星鋼の剣', slot: 'weapon', requiredLevel: 4, mods: { drawAtk: 0.15 }, desc: 'ドロー攻撃+15%' },
  { id: 'as_bow', name: '月弓', slot: 'weapon', requiredLevel: 2, mods: { straightAtk: 0.18 }, desc: 'ストレート攻撃+18%' },
  { id: 'as_spear', name: '穿ちの槍', slot: 'weapon', requiredLevel: 5, mods: { piercePower: 1 }, desc: 'ドロー貫通力+1' },
  { id: 'as_leather', name: '旅人の革鎧', slot: 'armor', requiredLevel: 1, mods: { maxHp: 60 }, desc: '最大HP+60' },
  { id: 'as_iron', name: '城壁の鎧', slot: 'armor', requiredLevel: 4, mods: { maxHp: 140 }, desc: '最大HP+140' },
  { id: 'as_wand', name: '灯火の杖', slot: 'tool', requiredLevel: 2, mods: { maxMp: 20 }, desc: '最大MP+20' },
  { id: 'as_scope', name: '遠見の筒', slot: 'tool', requiredLevel: 3, mods: { drawRange: 0.08 }, desc: 'ドロー射程+8%' },
  { id: 'as_magnet', name: '星屑の磁石', slot: 'tool', requiredLevel: 1, mods: { xpRange: 0.4 }, desc: '経験値の回収範囲+40%' },
  { id: 'as_feather', name: '羽根の靴', slot: 'accessory', requiredLevel: 1, mods: { speed: 0.06 }, desc: '移動速度+6%' },
  { id: 'as_gale', name: '疾風の長靴', slot: 'accessory', requiredLevel: 5, mods: { speed: 0.12 }, desc: '移動速度+12%' },
  { id: 'as_pendant', name: '流星の首飾り', slot: 'accessory', requiredLevel: 3, mods: { drawAtk: 0.06, maxHp: 40 }, desc: 'ドロー攻撃+6%・HP+40' },
];

export const SOULS: SoulDef[] = [
  { id: 'so_bull', name: '猛牛の魂', giantType: 'breaker', mods: { maxHp: 30 }, desc: '巨人：猛突進（触れた拠点を破壊）' },
  { id: 'so_storm', name: '旋風の魂', giantType: 'whirl', mods: { drawAtk: 0.04 }, desc: '巨人：暴旋風（兵士列を薙ぎ払う）' },
  { id: 'so_mother', name: '森の母の魂', giantType: 'support', mods: { maxMp: 10 }, desc: '巨人：回復しながら進軍' },
  { id: 'so_hammer', name: '鉄槌の魂', giantType: 'breaker', mods: { straightAtk: 0.06 }, desc: '巨人：猛突進（触れた拠点を破壊）' },
];

export const ASSIST_BY_ID: Record<string, AssistDef> = Object.fromEntries(ASSISTS.map((a) => [a.id, a]));
export const SOUL_BY_ID: Record<string, SoulDef> = Object.fromEntries(SOULS.map((s) => [s.id, s]));
