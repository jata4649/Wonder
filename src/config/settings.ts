// 実行時設定（ローカル保存）。
import { MATCH } from '../../shared/config/balance';
import type { Team } from '../../shared/config/types';

export interface Settings {
  /** false: 自軍＝赤（原作準拠・既定） / true: 自軍＝青 */
  swapColors: boolean;
  showFps: boolean;
}

const KEY = 'otogi-arena-settings';

function load(): Settings {
  const def: Settings = { swapColors: false, showFps: false };
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return def;
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function teamColor(team: Team): string {
  const ownRed = !settings.swapColors;
  const red = team === 0 ? ownRed : !ownRed;
  return red ? MATCH.teamColors.red : MATCH.teamColors.blue;
}

/** 薄い版（背景・軌跡用）。 */
export function teamTint(team: Team, alpha: number): string {
  const c = teamColor(team);
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
