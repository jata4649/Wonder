// 画像マニフェスト（SPEC 7.2）。画像を差し替える人はこのファイルだけ触ればよい。
// 空文字（または未登録）のキーはコード内のベクター描画にフォールバックする。
// 例: casters: { akazukin: 'assets/casters/akazukin.png' }
//     DPR が 2 以上の端末では 'akazukin@2x.png' を先に試し、無ければ等倍を使う。
import type { BaseKind, GiantType } from './types';

export const ASSETS = {
  casters: {
    akazukin: '',
    tetsukagi: '',
    nemurihime: '',
    kurousagi: '',
    garasu: '',
    hoshitsubame: '',
    onryo: '',
    shichinin: '',
  } as Record<string, string>,
  minions: {
    ally_small: '',
    ally_large: '',
    enemy_small: '',
    enemy_large: '',
  } as Record<string, string>,
  bases: {
    small: '',
    normal: '',
    large: '',
    huge: '',
    castle_ally: '',
    castle_enemy: '',
  } as Record<Exclude<BaseKind, 'castle'> | 'castle_ally' | 'castle_enemy', string>,
  giants: {
    breaker: '',
    whirl: '',
    support: '',
  } as Record<GiantType, string>,
};

export type AssetGroup = keyof typeof ASSETS;
