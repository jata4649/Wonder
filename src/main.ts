import { CASTERS, CASTER_BY_ID } from './config/casters';
import type { Loadout } from './config/types';
import { Game } from './game';
import { Renderer } from './render/renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const renderer = new Renderer(canvas);
window.addEventListener('resize', () => renderer.resize());

function defaultLoadout(casterId: string): Loadout {
  const c = CASTER_BY_ID[casterId] ?? CASTERS[0];
  return { casterId: c.id, skillIds: c.skills.slice(0, 3).map((s) => s.id), assistIds: [], soulId: '' };
}

const params = new URLSearchParams(location.search);
let game: Game;
function start() {
  game = new Game(renderer, uiRoot, { loadout: defaultLoadout(params.get('c') ?? 'akazukin') }, (again) => {
    if (again) start();
  });
  (window as any).__game = game;
}
start();
