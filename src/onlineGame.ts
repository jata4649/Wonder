// オンライン対戦のセッション。サーバーが唯一の正。クライアントは入力を送り、スナップショットを描画する。
// - 30Hz で入力（InputCmd）を送信し、自キャストはローカル予測で即応
// - 他者は 100ms の補間バッファで描画、ズレは reconciliation で修正
// - 遅延が 150ms を超えたら警告、300ms を超えたら操作不能の告知
import { NET, type ServerMsg, type SnapshotMsg, type WelcomeMsg } from '../shared/net/protocol';
import { NetMirror } from '../shared/net/mirror';
import type { Hero } from '../shared/sim/units/hero';
import { settings } from './config/settings';
import { InputManager } from './input/touch';
import { commandToInput, type NetClient } from './net/client';
import { Effects } from './render/effects';
import type { Renderer } from './render/renderer';
import { Cards } from './ui/cards';
import { Controls } from './ui/controls';
import { showResult } from './ui/result';

export class OnlineGame {
  mirror: NetMirror;
  input: InputManager;
  fx = new Effects();
  controls?: Controls;
  cards?: Cards;
  private raf = 0;
  private last = performance.now();
  private sendAcc = 0;
  private seq = 0;
  private running = true;
  private resultShown = false;
  private hud: HTMLDivElement;
  private endInfo: { mmr?: number; delta?: number } | null = null;
  private fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private snapsThisSec = 0;
  snapshotRate = 0;
  private rateT = 0;
  /** 送ったものの記録（「入力しか送っていない」ことの確認用） */
  get sentKinds() {
    return this.client.sentKinds;
  }

  constructor(
    private renderer: Renderer,
    private uiRoot: HTMLElement,
    public client: NetClient,
    welcome: WelcomeMsg,
    private onExit: (again: boolean) => void,
  ) {
    this.mirror = new NetMirror(welcome.seed, welcome.roster, welcome.heroId, welcome.team, welcome.spectator);
    const getHero = () => this.mirror.me;
    this.input = new InputManager(renderer.canvas, renderer.camera, getHero as () => Hero | undefined, () => this.mirror.world);
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
    if (!welcome.spectator && this.mirror.me) {
      this.controls = new Controls(uiRoot, this.input, getHero as () => Hero | undefined, (kind) => this.client.send({ k: 'signal', kind }));
      this.controls.onReset = () => cam.resetToHero();
      this.controls.getCamera = () => cam;
      this.controls.getMinimapRect = () => mm.rect;
      this.cards = new Cards(uiRoot, this.mirror.me, () => this.mirror.world);
      cam.snap(this.mirror.me.x, this.mirror.me.y);
    } else {
      this.input.enabled = true;
      cam.snap(1200, 1800);
    }
    renderer.viewTeam = 0; // 鏡ワールドでは自分は常に team 0（下）
    renderer.invalidateBackground();
    this.hud = document.createElement('div');
    this.hud.className = 'net-hud';
    uiRoot.appendChild(this.hud);
    client.on(this.onMsg);
    client.onClose((unexpected) => {
      if (unexpected && this.running) this.reconnect();
    });
    this.raf = requestAnimationFrame(this.frame);
  }

  private onMsg = (m: ServerMsg) => {
    switch (m.k) {
      case 'snap':
        this.mirror.apply(m as SnapshotMsg);
        this.snapsThisSec++;
        break;
      case 'notice':
        this.fx.banner(m.msg, '#cfe3ff', 2.4);
        break;
      case 'end':
        this.endInfo = { mmr: m.mmr, delta: m.delta };
        break;
      case 'welcome':
        // 再接続：元のキャストに戻った
        if (!m.spectator) {
          this.mirror.heroId = m.heroId;
          this.showBanner('');
        }
        break;
    }
  };

  /** 切断：30秒間は再接続を試みる（その間はサーバー側で AI が操作を引き継いでいる）。 */
  private reconnect(startedAt = performance.now()) {
    if (!this.running) return;
    const left = Math.ceil((NET.reconnectMs - (performance.now() - startedAt)) / 1000);
    if (left <= 0) {
      this.showBanner('再接続できませんでした（以降は AI が操作します）', true);
      return;
    }
    this.showBanner(`接続が切れました。再接続しています…（あと${left}秒・その間は AI が操作）`, true);
    this.client
      .connect(3000)
      .then(() => this.showBanner(''))
      .catch(() => setTimeout(() => this.reconnect(startedAt), 1500));
  }

  private showBanner(msg: string, warn = false) {
    let el = this.uiRoot.querySelector('.net-banner') as HTMLDivElement | null;
    if (!msg) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'net-banner';
      this.uiRoot.appendChild(el);
    }
    el.classList.toggle('warn', warn);
    el.textContent = msg;
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const me = this.mirror.me;
    // 入力：30Hz（サーバーの 1 tick ぶん）ごとに1つ送る
    if (me && !this.mirror.spectator) {
      this.input.apply();
      this.sendAcc += dt;
      const step = 1 / NET.tickHz;
      let n = 0;
      while (this.sendAcc >= step && n < 3) {
        this.sendAcc -= step;
        n++;
        const action = me.cmds.shift();
        const cmd = commandToInput(++this.seq, { x: me.moveX, y: me.moveY }, action);
        this.client.send({ k: 'input', cmd: this.mirror.toServer(cmd) });
        this.mirror.predict(cmd);
      }
      if (n >= 3) this.sendAcc = 0;
      // 鏡ワールドでは発動を実行しない（サーバーの結果を待つ）。溜まりすぎたら捨てる
      if (me.cmds.length > 4) me.cmds.splice(0, me.cmds.length - 4);
    }
    this.mirror.interpolate(this.client.serverNow(), dt);
    const w = this.mirror.world;
    const cam = this.renderer.camera;
    this.fx.push(this.mirror.drainEvents(), cam, me?.id ?? -1);
    this.fx.update(dt);
    const focus = me ?? w.heroes[0];
    if (focus) cam.follow(focus.x, focus.y, dt, now / 1000);
    cam.update(dt);
    this.fpsAcc += dt;
    this.fpsFrames++;
    this.rateT += dt;
    if (this.rateT >= 1) {
      this.snapshotRate = this.snapsThisSec / this.rateT;
      this.snapsThisSec = 0;
      this.rateT = 0;
    }
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.renderer.render(w, { player: me, input: this.input, fx: this.fx, dt, fps: settings.showFps ? this.fps : undefined });
    this.controls?.update();
    this.cards?.update();
    this.updateNetHud();
    if (w.match.result && !this.resultShown) {
      this.resultShown = true;
      this.input.enabled = false;
      setTimeout(() => {
        showResult(this.uiRoot, w, () => this.exit(true), () => this.exit(false));
        if (this.endInfo?.mmr !== undefined) {
          const p = this.uiRoot.querySelector('.result .panel .sub');
          if (p) p.textContent += ` ／ レート ${this.endInfo.mmr}（${(this.endInfo.delta ?? 0) >= 0 ? '+' : ''}${this.endInfo.delta}）`;
        }
      }, 600);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private updateNetHud() {
    const rtt = Math.round(this.client.rtt);
    const lvl = rtt > NET.severeRttMs ? 'bad' : rtt > NET.warnRttMs ? 'warn' : 'ok';
    const label = this.mirror.spectator ? '観戦中（1分遅れ）' : '';
    this.hud.className = `net-hud ${lvl}`;
    this.hud.textContent = `${label}${label ? ' ' : ''}${rtt}ms`;
    if (lvl === 'bad') this.showBanner('通信が不安定です（遅延が大きく操作できません）', true);
    else if (this.uiRoot.querySelector('.net-banner.warn') && this.client.ws?.readyState === WebSocket.OPEN) this.showBanner('');
  }

  exit(again: boolean) {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.controls?.destroy();
    this.cards?.destroy();
    this.hud.remove();
    this.showBanner('');
    this.input.enabled = false;
    this.client.close();
    this.onExit(again);
  }
}
