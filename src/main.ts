import { Renderer } from './render/renderer';
import { World } from './sim/world';
import { showResult } from './ui/result';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
let world = new World({ seed: Date.now() & 0xffff });
const renderer = new Renderer(canvas);
window.addEventListener('resize', () => renderer.resize());
let resultShown = false;

// M1-M3: ドラッグで盤面を見回す（デバッグ）
let drag: { id: number; x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => (drag = { id: e.pointerId, x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  renderer.camera.pan(e.clientX - drag.x, e.clientY - drag.y, performance.now() / 1000);
  drag.x = e.clientX;
  drag.y = e.clientY;
});
canvas.addEventListener('pointerup', () => (drag = null));

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= 1 / 60) {
    world.step(1 / 60);
    acc -= 1 / 60;
  }
  world.drainEvents();
  if (world.wallsDirty) world.wallsDirty = false;
  if (world.ended && !resultShown) {
    resultShown = true;
    showResult(uiRoot, world, () => {
      world = new World({ seed: Date.now() & 0xffff });
      resultShown = false;
      (window as any).__world = world;
    });
  }
  renderer.camera.update(dt);
  renderer.render(world);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as any).__world = world;
(window as any).__renderer = renderer;
