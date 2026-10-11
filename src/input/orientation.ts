// 画面の向き。ワールドは回転しない（SPEC 1.1）。横画面では縦長の盤面を
// 「フィールド幅＝画面幅」で表示し、カメラを上下（y）に送る。自陣が下・敵陣が上、レーンは上下に走る。
import type { LaneId } from '../config/types';

export const orient = {
  /** 横画面か（innerWidth > innerHeight） */
  land: false,
};

export function updateOrientation(): boolean {
  const before = orient.land;
  orient.land = window.innerWidth > window.innerHeight;
  return before !== orient.land;
}

/** 横画面にロック（対応ブラウザのみ。失敗しても動く）。ユーザー操作の中で呼ぶ。 */
export async function tryLockLandscape() {
  try {
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (!so?.lock) return;
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => undefined);
    }
    await so.lock('landscape');
  } catch {
    /* 非対応・拒否は無視 */
  }
}

/** レーン名（向きに関係なく 左/中央/右）。 */
export function laneName(lane: LaneId | number): string {
  return ['左', '中央', '右'][lane] ?? '';
}
