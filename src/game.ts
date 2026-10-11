// 1試合ぶんのセッション：World・入力・描画・UI をまとめる。
import { MATCH } from './config/balance';
import type { Loadout } from './config/types';
import { InputManager } from './input/touch';
import { Effects } from './render/effects';
import type { Renderer } from './render/renderer';
import type { Hero } from './sim/units/hero';
import { World } from './sim/world';
import { Controls } from './ui/controls';
import { showResult } from './ui/result';

export interface GameOptions {
  loadout: Loadout;
  seed?: number;
}

export class Game {
  world: World;
  player: Hero;
  input: InputManager;
  fx = new Effects();
  controls: Controls;
  private acc = 0;
  private last = performance.now();
  private raf = 0;
  private resultShown = false;
  private running = true;

  constructor(
    private renderer: Renderer,
    private uiRoot: HTMLElement,
    opts: GameOptions,
    private onExit: (again: boolean) => void,
  ) {
    this.world = new World({ seed: opts.seed ?? (Date.now() & 0xffff) });
    this.player = this.world.addHero(opts.loadout, 0, true, 1);
    this.input = new InputManager(renderer.canvas, renderer.camera, () => this.player, () => this.world);
    this.controls = new Controls(uiRoot, this.input, () => this.player);
    renderer.camera.x = this.player.x;
    renderer.camera.y = this.player.y;
    renderer.invalidateBackground();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.world;
    this.input.apply();
    this.acc += dt;
    const step = MATCH.fixedDt;
    let n = 0;
    while (this.acc >= step && n < 6) {
      w.step(step);
      this.acc -= step;
      n++;
    }
    if (n >= 6) this.acc = 0;
    const cam = this.renderer.camera;
    this.fx.push(w.drainEvents(), cam, this.player.id);
    this.fx.update(dt);
    if (w.wallsDirty) w.wallsDirty = false;
    if (this.player.alive) cam.follow(this.player.x, this.player.y, dt, now / 1000);
    cam.update(dt);
    this.renderer.render(w, { player: this.player, input: this.input, fx: this.fx });
    this.controls.update();
    if (w.ended && !this.resultShown) {
      this.resultShown = true;
      this.input.enabled = false;
      showResult(this.uiRoot, w, () => this.exit(true), () => this.exit(false));
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  exit(again: boolean) {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.controls.destroy();
    this.input.enabled = false;
    this.onExit(again);
  }
}
