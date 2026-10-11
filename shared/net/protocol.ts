// 通信プロトコル（SPEC 8）。クライアントとサーバーで共有する。
// - クライアント → サーバー：入力（InputCmd）だけ。位置・HP・MP・CD は絶対に送らない。
// - サーバー → クライアント：スナップショット（差分）。サーバーが唯一の正。
import type { Difficulty, Loadout, Team } from '../config/types';

export const NET = {
  /** サーバーの固定 tick（Hz）。1 tick = シミュレーション 2 ステップ（1/60s×2）。 */
  tickHz: 30,
  simStepsPerTick: 2,
  /** スナップショット配信（Hz）。tick の 1/2。 */
  snapshotHz: 15,
  /** 他キャストの補間バッファ（ms） */
  interpMs: 100,
  /** 体感遅延の警告・操作不能の告知（ms, RTT） */
  warnRttMs: 150,
  severeRttMs: 300,
  /** 切断から再接続を待つ時間（ms）。過ぎたら最後まで AI */
  reconnectMs: 30_000,
  /** マッチメイキングの待機上限（ms）。過ぎたら CPU で補充して開始 */
  matchWaitMs: 30_000,
  /** 観戦の遅延（ms） */
  spectateDelayMs: 60_000,
  /** 描画速度の上限（px/ms）。これより速い描線は物理的に不可能として拒否 */
  maxDrawPxPerMs: 12,
  /** 1回の描線の制御点の上限 */
  maxDrawPoints: 240,
  /** 入力キューの上限（溜まりすぎたら古い移動入力を捨てる） */
  maxQueuedInputs: 6,
} as const;

/** InputCmd.buttons のビット。1入力で発動できるのは1つだけ（複数立っていたら拒否）。 */
export const BTN = {
  SS: 1,
  DS: 2,
  EVADE: 4,
  CARD: 8,
  WS: 16,
} as const;

/** クライアント → サーバー（毎 tick）。 */
export interface InputCmd {
  seq: number; // 連番（reconciliation 用）
  t: number; // クライアント時刻（ms）
  move: { x: number; y: number }; // スティック（正規化）
  buttons: number; // BTN のビットフラグ
  /** DS の軌跡（ワールド座標の制御点列 [x0,y0,x1,y1,...]）と描くのにかかった時間 */
  draw?: { points: number[]; durMs: number };
  /** SS・カード・WS の狙い（ワールド座標） */
  aim?: { x: number; y: number };
  /** カードのスロット（0..2） */
  card?: number;
  /** 回避の方向 */
  dir?: { x: number; y: number };
}

export type MatchMode = 'coop' | 'quick' | 'room' | 'spectate';

/** 参加要求。 */
export interface HelloMsg {
  k: 'hello';
  name: string;
  /** 再接続・レート用の識別子（端末に保存） */
  token: string;
  mode: MatchMode;
  loadout: Loadout;
  difficulty?: Difficulty;
  /** ルーム対戦：ルームコード・パスワード（任意） */
  room?: { code: string; password?: string; create?: boolean };
  /** パーティ（同一チームに入れる） */
  party?: string;
  /** 観戦する部屋 */
  watch?: string;
}

export type ClientMsg =
  | HelloMsg
  | { k: 'input'; cmd: InputCmd }
  | { k: 'ping'; t: number }
  | { k: 'start' } // ルームのホストが開始
  | { k: 'signal'; kind: 'gather' | 'retreat' | 'caution' | 'enemy' } // ピング（位置はサーバーが自キャストから決める）
  | { k: 'leave' };

/** 参加者の静的情報（試合開始時に1回）。 */
export interface RosterEntry {
  id: number; // キャストの id（ワールド内）
  team: Team;
  name: string;
  human: boolean;
  loadout: Loadout;
}

export interface WelcomeMsg {
  k: 'welcome';
  roomId: string;
  /** 自分が操作するキャストの id（観戦者は -1） */
  heroId: number;
  team: Team;
  seed: number;
  roster: RosterEntry[];
  token: string;
  spectator: boolean;
}

/** エンティティ1件 = 量子化済みの数値配列（先頭は id）。 */
export type Ent = (number | string)[];
export interface EntDelta {
  u?: Ent[]; // 追加・変更
  d?: number[]; // 削除
}

export interface SnapshotMsg {
  k: 'snap';
  tick: number;
  /** サーバーの壁時計（ms）。補間・時計補正に使う */
  st: number;
  /** シミュレーション時刻（秒）。門の開門アニメ等 */
  wt: number;
  /** 自分の入力をどこまで処理したか（reconciliation） */
  ack: number;
  /** [残り時間×10, 自軍ゲージ×10, 敵軍ゲージ×10, 結果(-1:なし,0,1,2:引き分け), 決着理由(0 gauge/1 time)] */
  m: number[];
  /** [xp0, lv0, xp1, lv1] */
  p: number[];
  /** 自軍のソウル [ゲージ×10, 予告ソウルid, 予告レーン]（観戦は両軍） */
  s: (number | string)[];
  s2?: (number | string)[];
  fz: number; // 巨人召喚の一時停止中
  e: Record<string, EntDelta>;
  ev?: NetEvent[];
}

/** ゲームイベント（演出用）。参照は id で送る。 */
export type NetEvent =
  | { t: 'damage'; x: number; y: number; a: number; team: Team; fx?: string; big?: boolean; tid?: number }
  | { t: 'blast'; x: number; y: number; r: number; team: Team }
  | { t: 'sweep'; x: number; y: number; dx: number; dy: number; team: Team }
  | { t: 'ram'; x: number; y: number; team: Team }
  | { t: 'heal'; x: number; y: number; a: number; team: Team }
  | { t: 'chain'; hid: number; n: number; xp: number }
  | { t: 'cross'; hid: number; x: number; y: number; solo: boolean }
  | { t: 'levelUp'; team: Team; lv: number }
  | { t: 'heroKilled'; hid: number; by: Team }
  | { t: 'baseDestroyed'; bid: number; by: Team }
  | { t: 'gateOpen'; bid: number }
  | { t: 'soulAnnounce'; team: Team; soul: string; lane: number }
  | { t: 'giantSummon'; gid: number }
  | { t: 'giantKilled'; team: Team; type: string; x: number; y: number }
  | { t: 'ping'; team: Team; kind: string; x: number; y: number }
  | { t: 'wonder'; hid: number };

export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | { k: 'pong'; t: number; st: number }
  | { k: 'lobby'; mode: MatchMode; waiting: number; humans: number; waitedMs: number; limitMs: number; roomCode?: string; host?: boolean }
  | { k: 'end'; mmr?: number; delta?: number }
  | { k: 'error'; msg: string }
  | { k: 'notice'; msg: string };

/** 入力のビットから発動の種類（複数立っていたら null＝不正）。 */
export function actionOf(buttons: number): keyof typeof BTN | null | 'none' {
  if (!buttons) return 'none';
  const hits = (Object.keys(BTN) as (keyof typeof BTN)[]).filter((k) => buttons & BTN[k]);
  return hits.length === 1 ? hits[0] : null;
}
