// 画面の向き。横画面（land）では縦長ワールドを90°回転して描く（SPEC 1.3）。
// 自陣（ワールド下側 = y大）が画面の左、敵陣が右になり、レーンは左右に走る。
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

/** レーン名：横画面ではワールド x 小→画面上 なので 上/中/下、縦画面では 左/中央/右。 */
export function laneName(lane: LaneId | number): string {
  return (orient.land ? ['上', '中', '下'] : ['左', '中央', '右'])[lane] ?? '';
}
