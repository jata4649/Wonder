import { Game } from './game';
import { Renderer } from './render/renderer';
import { defaultLoadout, showTitle, type TitleResult } from './ui/screens/title';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const renderer = new Renderer(canvas);
window.addEventListener('resize', () => renderer.resize());

let game: Game | undefined;
let lastSetup: TitleResult | undefined;

function start(setup: TitleResult) {
  lastSetup = setup;
  game = new Game(renderer, uiRoot, { loadout: setup.loadout, difficulty: setup.difficulty }, (again) => {
    if (again && lastSetup) start(lastSetup);
    else title();
  });
  (window as any).__game = game;
}

function title() {
  game = undefined;
  showTitle(uiRoot, start);
}

// ?c=<casterId> でタイトルを飛ばして即開始（テスト用）
const params = new URLSearchParams(location.search);
const quick = params.get('c');
if (quick) start({ loadout: defaultLoadout(quick), difficulty: (params.get('d') as any) ?? 'normal' });
else title();
