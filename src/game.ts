// 1試合ぶんのセッション：World・入力・描画・UI をまとめる。
import { MATCH } from '../shared/config/balance';
import { settings } from './config/settings';
import type { Difficulty, Loadout } from '../shared/config/types';
import { setupMatch } from '../shared/ai/setup';
import { InputManager } from './input/touch';
import { Effects } from './render/effects';
import type { Renderer } from './render/renderer';
import type { Hero } from '../shared/sim/units/hero';
import { World } from '../shared/sim/world';
import { Cards } from './ui/cards';
import { Controls } from './ui/controls';
import { showResult } from './ui/result';

export interface GameOptions {
  loadout: Loadout;
  difficulty: Difficulty;
  seed?: number;
  showFps?: boolean;
}

export class Game {
  world: World;
  player: Hero;
  input: InputManager;
  fx = new Effects();
  controls: Controls;
  cards: Cards;
  private acc = 0;
  private last = performance.now();
  private raf = 0;
  private resultShown = false;
  private running = true;
  private fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(
    private renderer: Renderer,
    private uiRoot: HTMLElement,
    private opts: GameOptions,
    private onExit: (again: boolean) => void,
  ) {
    this.world = new World({ seed: opts.seed ?? (Date.now() & 0xffff) });
    this.player = setupMatch(this.world, opts.loadout, opts.difficulty).player!;
    this.input = new InputManager(renderer.canvas, renderer.camera, () => this.player, () => this.world);
    this.controls = new Controls(uiRoot, this.input, () => this.player, (kind, x, y) => this.world.addPing(0, kind, x, y));
    // ミニマップのタップ：パン中ならカメラリセット（SPEC 1.2）、そうでなければ拡大／戻す。
    // 拡大中は画面のどこをタップしても戻す。
    const mm = renderer.minimap;
    const cam = renderer.camera;
    mm.expanded = false;
    this.input.uiHitTest = (sx, sy) => {
      if (mm.expanded) {
        mm.toggle();
        return true;
      }
      if (mm.hit(sx, sy)) {
        if (cam.panned) cam.resetToHero();
        else mm.toggle();
        return true;
      }
      return false;
    };
    this.controls.onReset = () => cam.resetToHero();
    this.controls.getCamera = () => cam;
    this.controls.getMinimapRect = () => mm.rect;
    this.cards = new Cards(uiRoot, this.player, () => this.world);
    renderer.camera.snap(this.player.x, this.player.y);
    renderer.invalidateBackground();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 直近フレームの処理時間（ms, 計測用） */
  frameMs = 0;

  private frame = (now: number) => {
    if (!this.running) return;
    const t0 = performance.now();
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
    // 自キャストの足元を注視（y はオフセット付き）。撤退中は最後の位置／復活後は城前
    cam.follow(this.player.x, this.player.y, dt, now / 1000);
    cam.update(dt);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.renderer.render(w, {
      player: this.player,
      input: this.input,
      fx: this.fx,
      dt,
      fps: settings.showFps || this.opts.showFps ? this.fps : undefined,
    });
    this.controls.update();
    this.cards.update();
    if (w.ended && !this.resultShown) {
      this.resultShown = true;
      this.input.enabled = false;
      showResult(this.uiRoot, w, () => this.exit(true), () => this.exit(false));
    }
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.raf = requestAnimationFrame(this.frame);
  };

  exit(again: boolean) {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.controls.destroy();
    this.cards.destroy();
    this.input.enabled = false;
    this.onExit(again);
  }
}
