// 画像の非同期ロード＋キャッシュ。ロード前・失敗時は undefined を返し、呼び出し側がベクター描画する。
import { ASSETS, type AssetGroup } from '../config/assets';

type Entry = { state: 'loading' | 'ok' | 'failed'; img?: HTMLImageElement };
const cache = new Map<string, Entry>();

function resolve(path: string) {
  // 先頭の '/' は base（./）からの相対にする
  return path.startsWith('/') ? `.${path}` : path;
}

function load(key: string, path: string) {
  const entry: Entry = { state: 'loading' };
  cache.set(key, entry);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const candidates = dpr >= 2 && !/@2x\./.test(path) ? [path.replace(/(\.\w+)$/, '@2x$1'), path] : [path];
  const tryNext = (i: number) => {
    if (i >= candidates.length) {
      entry.state = 'failed'; // そのキーだけフォールバック
      return;
    }
    const img = new Image();
    img.onload = () => {
      entry.state = 'ok';
      entry.img = img;
    };
    img.onerror = () => tryNext(i + 1);
    img.src = resolve(candidates[i]);
  };
  tryNext(0);
}

/** 画像が使えるなら返す（未登録・ロード中・失敗なら undefined）。 */
export function getImage(group: AssetGroup, key: string): HTMLImageElement | undefined {
  const path = (ASSETS[group] as Record<string, string>)[key];
  if (!path) return undefined;
  const k = `${group}:${key}`;
  const e = cache.get(k);
  if (!e) {
    load(k, path);
    return undefined;
  }
  return e.state === 'ok' ? e.img : undefined;
}

/** 起動時に全画像の読み込みを始める（待たない）。 */
export function preloadAssets() {
  for (const group of Object.keys(ASSETS) as AssetGroup[]) {
    for (const key of Object.keys(ASSETS[group])) getImage(group, key);
  }
}
