// 内部レート（MMR）。Elo 方式＋試合内の貢献（拠点破壊・与ダメージ）で少し上下。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class MmrStore {
  private map = new Map<string, number>();

  constructor(private file?: string) {
    if (file && existsSync(file)) {
      try {
        const obj = JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>;
        for (const [k, v] of Object.entries(obj)) this.map.set(k, v);
      } catch {
        /* 壊れていたら初期化 */
      }
    }
  }

  get(token: string) {
    return this.map.get(token) ?? 1500;
  }

  /** score: 勝ち1・引き分け0.5・負け0。戻り値は変化量。 */
  update(token: string, opponentAvg: number, score: number, perf: { basesDestroyed: number; damage: number }) {
    const cur = this.get(token);
    const expected = 1 / (1 + Math.pow(10, (opponentAvg - cur) / 400));
    const K = 32;
    const bonus = Math.min(4, perf.basesDestroyed) + Math.min(4, perf.damage / 800);
    const delta = K * (score - expected) + bonus;
    this.map.set(token, cur + delta);
    this.save();
    return delta;
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map)));
    } catch {
      /* 保存失敗は無視（メモリには残る） */
    }
  }
}
