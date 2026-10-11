import { Game } from './game';
import { tryLockLandscape } from './input/orientation';
import { preloadAssets } from './render/assets';
import { Renderer } from './render/renderer';
import { updateOrientationOverlay } from './ui/orientationOverlay';
import { spawnSquad } from './sim/minions';
import { defaultLoadout, showTitle, type TitleResult } from './ui/screens/title';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const renderer = new Renderer(canvas);
preloadAssets();

/** 向き変更・リサイズ時に land を再評価して再計算（縦画面フォールバックも維持）。 */
function onResize() {
  renderer.resize();
  updateOrientationOverlay(uiRoot, !!game);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

let game: Game | undefined;
let lastSetup: TitleResult | undefined;
const params = new URLSearchParams(location.search);

function start(setup: TitleResult) {
  lastSetup = setup;
  void tryLockLandscape();
  game = new Game(renderer, uiRoot, { loadout: setup.loadout, difficulty: setup.difficulty, showFps: params.has('fps') }, (again) => {
    if (again && lastSetup) start(lastSetup);
    else title();
  });
  (window as any).__game = game;
  updateOrientationOverlay(uiRoot, true);
  if (params.has('stress')) stress(game);
}

/** 負荷テスト：兵士・巨人・エフェクトを大量に出す（?stress=1&fps=1）。 */
function stress(g: Game) {
  const w = g.world;
  for (const team of [0, 1] as const) {
    for (const lane of [0, 1, 2] as const) {
      w.summonGiant(team, lane, { id: `stress${team}${lane}`, name: '負荷', giantType: (['breaker', 'whirl', 'support'] as const)[lane] });
      for (let k = 0; k < 4; k++) spawnSquad(w, team, lane, 'castle', 9, 1, 600 + lane * 600, team === 0 ? 2200 + k * 120 : 1400 - k * 120);
    }
  }
  w.freezeT = 0;
  g.player.x = 1200;
  g.player.y = 1900;
}

function title() {
  game = undefined;
  updateOrientationOverlay(uiRoot, false);
  showTitle(uiRoot, start);
}

// ?c=<casterId> でタイトルを飛ばして即開始（テスト用）
const quick = params.get('c');
if (quick) start({ loadout: defaultLoadout(quick), difficulty: (params.get('d') as any) ?? 'normal' });
else title();
(window as any).__renderer = renderer;
