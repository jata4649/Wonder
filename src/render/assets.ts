// 画像の非同期ロード＋キャッシュ（SPEC 7.2）。
// - ロード前・失敗時は undefined を返し、呼び出し側がベクター描画にフォールバックする（そのキーだけ）。
// - dpr >= 2 では `@2x` を優先し、無ければ等倍（resolveAsset）。
// - premultiplyAlpha を無効にしてデコード（透過PNGの縁が暗くならないように）。
import { ASSETS } from '../../shared/config/assets';
import type { BaseKind, GiantType, Team } from '../../shared/config/types';

export type Img = HTMLImageElement | ImageBitmap;
type Entry = { state: 'loading' | 'ok' | 'failed'; img?: Img };
const cache = new Map<string, Entry>();
let readyVersion = 0;

/** 何か画像がロードし終わるたびに増える（背景キャッシュの作り直し判定用）。 */
export function assetsVersion() {
  return readyVersion;
}

/** public/ からの絶対パス → 実際に読むURL候補（@2x 優先）。 */
export function resolveAsset(path: string, dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1): string[] {
  const rel = path.startsWith('/') ? `.${path}` : path; // vite の base './' に合わせる
  if (dpr >= 2 && !/@2x\./.test(rel)) return [rel.replace(/(\.\w+)$/, '@2x$1'), rel];
  return [rel];
}

function load(path: string) {
  const entry: Entry = { state: 'loading' };
  cache.set(path, entry);
  const candidates = resolveAsset(path);
  const tryNext = (i: number) => {
    if (i >= candidates.length) {
      entry.state = 'failed';
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const done = (bmp: Img) => {
        entry.img = bmp;
        entry.state = 'ok';
        readyVersion++;
      };
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(img, { premultiplyAlpha: 'none' })
          .then(done)
          .catch(() => done(img));
      } else done(img);
    };
    img.onerror = () => tryNext(i + 1);
    img.src = candidates[i];
  };
  tryNext(0);
}

/** パスの画像が使えるなら返す（空文字・ロード中・失敗なら undefined）。 */
export function img(path: string | undefined | null): Img | undefined {
  if (!path) return undefined;
  const e = cache.get(path);
  if (!e) {
    if (typeof Image === 'undefined') return undefined; // ヘッドレス（テスト）
    load(path);
    return undefined;
  }
  return e.state === 'ok' ? e.img : undefined;
}

// ---- 役割別のアクセサ（SPEC 7.1 の割り当て） ----

/** フィールドの駒：背景抜き sprite のみ（未提供ならベクター描画）。 */
export const casterSprite = (id: string) => img(ASSETS.casters[id]?.sprite);
/** HUD・選択画面の小枠：丸アイコン（透過）。 */
export const casterIcon = (id: string) => img(ASSETS.casters[id]?.icon);
/** 選択画面の立ち絵。 */
export const casterPortrait = (id: string) => img(ASSETS.casters[id]?.portrait);
export const casterBust = (id: string) => img(ASSETS.casters[id]?.bust);

export function minionImg(ally: boolean, big: boolean, alt: boolean) {
  const m = ASSETS.minions;
  if (alt && ally) return img(big ? m.largeAlt : m.smallAlt) ?? img(big ? m.large.ally : m.small.ally);
  const g = big ? m.large : m.small;
  return img(ally ? g.ally : g.enemy);
}

export function baseImg(kind: BaseKind, team: Team, viewTeam: Team) {
  if (kind === 'castle') return img(ASSETS.bases[team === viewTeam ? 'castle_ally' : 'castle_enemy']);
  return img(ASSETS.bases[kind]);
}

export const gateImg = (kind: 'setsuna' | 'yukyu' | 'none') => img(ASSETS.gates[kind === 'yukyu' ? 'yuukyu' : 'sekkina']);

/** 巨人：背景抜き sprite（駒用）と原画 art（背景付き。丸く切り抜いて使う）。 */
export const giantSprite = (t: GiantType) => img(ASSETS.giants[t]?.sprite);
export const giantArt = (t: GiantType) => img(ASSETS.giants[t]?.art);

export const uiImg = (k: keyof typeof ASSETS.ui) => img(ASSETS.ui[k]);
export const bgTile = () => img(ASSETS.bg.tileV);

/** 画像の URL（DOM の <img> 用）。空なら ''。 */
export function assetUrl(path: string | undefined): string {
  return path ? resolveAsset(path, 1)[0] : '';
}

/** 起動時に全画像の読み込みを始める（待たない）。 */
export function preloadAssets() {
  const walk = (o: unknown) => {
    if (typeof o === 'string') {
      // 横レーン案用の tileH は現仕様では使わないので読まない
      if (o && o !== ASSETS.bg.tileH) img(o);
    } else if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v);
  };
  walk(ASSETS);
}
