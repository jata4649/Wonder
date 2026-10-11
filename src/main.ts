import type { HelloMsg, WelcomeMsg } from '../shared/net/protocol';
import { Game } from './game';
import { tryLockLandscape } from './input/orientation';
import { NetClient, deviceToken, serverUrl } from './net/client';
import { OnlineGame } from './onlineGame';
import { preloadAssets } from './render/assets';
import { Renderer } from './render/renderer';
import { spawnSquad } from '../shared/sim/minions';
import { updateOrientationOverlay } from './ui/orientationOverlay';
import { LobbyScreen } from './ui/screens/lobby';
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

let game: Game | OnlineGame | undefined;
let lastSetup: TitleResult | undefined;
const params = new URLSearchParams(location.search);

function start(setup: TitleResult) {
  lastSetup = setup;
  void tryLockLandscape();
  if (setup.mode && setup.mode !== 'solo') return startOnline(setup);
  startSolo(setup);
}

/** ソロ（CPU戦）：shared/sim をローカルで回す。サーバー不要。 */
function startSolo(setup: TitleResult) {
  game = new Game(renderer, uiRoot, { loadout: setup.loadout, difficulty: setup.difficulty, showFps: params.has('fps') }, (again) => {
    if (again && lastSetup) start(lastSetup);
    else title();
  });
  (window as any).__game = game;
  updateOrientationOverlay(uiRoot, true);
  if (params.has('stress')) stress(game);
}

/** オンライン（協力／4対4／ルーム／観戦）：サーバーが正。 */
function startOnline(setup: TitleResult) {
  const mode = setup.mode as Exclude<NonNullable<TitleResult['mode']>, 'solo'>;
  const hello: HelloMsg = {
    k: 'hello',
    name: setup.name || 'プレイヤー',
    token: deviceToken(),
    mode,
    loadout: setup.loadout,
    difficulty: setup.difficulty,
    ...(mode === 'room' ? { room: { code: setup.roomCode ?? '', password: setup.roomPassword || undefined } } : {}),
    ...(params.get('party') ? { party: params.get('party')! } : {}),
  };
  const client = new NetClient(serverUrl(), hello);
  (window as any).__client = client;
  const lobby = new LobbyScreen(uiRoot, {
    onCancel: () => {
      client.close();
      lobby.destroy();
      title();
    },
    onStartRoom: () => client.send({ k: 'start' }),
    onOffline: () => {
      lobby.destroy();
      startSolo({ ...setup, mode: 'solo' });
    },
  });
  let started = false;
  client.on((m) => {
    if (m.k === 'welcome' && !started) {
      started = true;
      lobby.destroy();
      game = new OnlineGame(renderer, uiRoot, client, m as WelcomeMsg, (again) => {
        if (again && lastSetup) start(lastSetup);
        else title();
      });
      (window as any).__game = game;
      updateOrientationOverlay(uiRoot, true);
    } else if (!started) lobby.update(m);
  });
  client.connect().catch(() => lobby.offline(`${serverUrl()} に繋がりませんでした。`));
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

// ?c=<casterId> でタイトルを飛ばして即開始（テスト用）。&mode=quick 等でオンライン
const quick = params.get('c');
if (quick) {
  start({
    loadout: defaultLoadout(quick),
    difficulty: (params.get('d') as any) ?? 'normal',
    mode: (params.get('mode') as any) ?? 'solo',
    name: params.get('name') ?? undefined,
    roomCode: params.get('room') ?? undefined,
  });
} else title();
(window as any).__renderer = renderer;
