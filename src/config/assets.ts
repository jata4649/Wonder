// config/assets.ts
// ============================================================================
//  画像を差し替えるときは、このファイルだけ触ればよい。
//  ・''（空文字）または未登録のキーは、コード内のベクター描画にフォールバックする。
//  ・現状で空なのは giants.support だけ（＋将来のキャスト追加枠）。
//  ・パスは public/ からの絶対パス。
// ============================================================================

/** 1キャスト分の画像4点セット */
export interface CasterArt {
  /** 立ち絵（全身・背景付き）。選択画面・図鑑・リザルトで使う */
  portrait: string;
  /** バストアップ（背景付き）。選択画面のアップ・会話演出で使う。無いキャストは '' */
  bust: string;
  /** 丸アイコン 256px（透過）。HUD・選択画面の小枠で使う */
  icon: string;
  /** 背景を抜いた全身。フィールドの駒用。※未提供（第7.4節）。空ならベクター描画でフォールバック */
  sprite: string;
}

const C = (id: string, bust = true): CasterArt => ({
  portrait: `/assets/casters/${id}.png`,
  bust: bust ? `/assets/casters/bust/${id}.png` : '',
  icon: `/assets/casters/icon/${id}.png`,
  sprite: '',   // 背景抜きは未提供。届いたら '/assets/casters/sprite/<id>.png' を入れる
});

export const ASSETS = {
  // ── キャスター（8体・受領済み）────────────────────────────────────
  casters: {
    akazukin: C('akazukin'),            // 赤ずきん     curve・平均型
    tetsukagi: C('tetsukagi'),          // 鍵杖の紳士   curve・射程520／鋭角で停滞
    nemurihime: C('nemurihime'),        // 眠り姫       curve・描線長660 最長
    kurousagi: C('kurousagi'),          // 黒うさぎ     curve・非ダウン
    garasunokutsu: C('garasunokutsu'),  // ガラスの靴   lob・投擲
    hoshitsubame: C('hoshitsubame', false), // 翼の少年 leap・壁越え（バストアップ未受領）
    onryou: C('onryou'),                // 筆神         charge・2ヒット
    shichinin: C('shichinin'),          // 面の少年     curve・3発同時
  } as Record<string, CasterArt>,

  // ── 追加キャスト枠（9・10人目。予備。実装するならここを埋める）──
  castersExtra: {
    hoshikagari: { portrait: '/assets/casters_extra/hoshikagari.png',
                   bust: '', icon: '/assets/casters/icon/hoshikagari.png', sprite: '' },
    hatsumei:    { portrait: '', bust: '/assets/casters/bust/hatsumei.png',
                   icon: '/assets/casters/icon/hatsumei.png',
                   sprite: '' },
  } as Record<string, CasterArt>,

  // ── 兵士（ミニオン）──────────────────────────────────────────────
  minions: {
    small: { ally: '/assets/minions/ally_small.png', enemy: '/assets/minions/enemy_small.png' },
    large: { ally: '/assets/minions/ally_large.png', enemy: '/assets/minions/enemy_large.png' },
    smallAlt: '/assets/minions/ally_small_alt.png',
    largeAlt: '/assets/minions/ally_large_alt.png',
  },

  // ── 拠点 ────────────────────────────────────────────────────────
  bases: {
    small: '/assets/bases/small.png',        // 小拠点    hp 1300 / gauge  5 / 端レーン手前
    normal: '/assets/bases/normal.png',      // 通常拠点  hp 2000 / gauge  8
    large: '/assets/bases/large.png',        // 大拠点    hp 3100 / gauge 12
    huge: '/assets/bases/huge.png',          // 特大拠点  hp 4400 / gauge 18 / 中レーン奥
    castle_ally: '/assets/bases/castle_ally.png',
    castle_enemy: '/assets/bases/castle_enemy.png',   // 自陣アートの色相変換（暫定）
  } as Record<string, string>,

  // ── 刻の門（閉門中はダメージ無効）────────────────────────────────
  gates: {
    sekkina: '/assets/gates/sekkina.png',    // 刹那門 ≒ 12秒
    yuukyu: '/assets/gates/yuukyu.png',      // 悠久門 ≒ 65秒
  } as Record<string, string>,

  // ── 巨人（2/3 受領済み）─────────────────────────────────────────
  giants: {
    breaker: { art: '/assets/giants/breaker.png', sprite: '' },
    whirl:   { art: '/assets/giants/whirl.png',   sprite: '' },
    support: { art: '', sprite: '' },   // 未受領 → ベクター描画でフォールバック
  } as Record<string, { art: string; sprite: string }>,

  // ── UI ──────────────────────────────────────────────────────────
  ui: {
    titleLogo: '/assets/ui/title_logo.png',
    panelFrame: '/assets/ui/panel_frame.png',   // スキルカード枠に流用
    soulStar: '/assets/ui/soul_star.png',       // 経験値（インクの星）
    spiritOrb: '/assets/ui/spirit_orb.png',     // ソウルゲージ玉
    iconFlag: '/assets/ui/icon_flag.png',       // ピング：集合
    iconArrow: '/assets/ui/icon_arrow.png',     // ピング：撤退
    iconAlert: '/assets/ui/icon_alert.png',     // ピング：警告
    iconExtra: '/assets/ui/icon_extra.png',     // ピング：敵（キツネ面）
  },

  // ── 背景タイル ──────────────────────────────────────────────────
  bg: {
    // 縦3レーン（原作仕様）では tileV を使う。道が上下に走る。
    tileV: '/assets/bg/map_tile_v.png',
    // tileH は「レーンを左右に走らせる」案用の90°回転版。現在の仕様では使わない。
    tileH: '/assets/bg/map_tile_h.png',
  },
} as const;
