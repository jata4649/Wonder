// WebSocket クライアント：接続・時計合わせ（RTT/2）・入力送信・再接続。
import type { ClientMsg, HelloMsg, InputCmd, ServerMsg } from '../../shared/net/protocol';
import type { Command } from '../../shared/sim/units/hero';
import { BTN } from '../../shared/net/protocol';

export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** 端末ごとの識別子（再接続・レート用）。 */
export function deviceToken(): string {
  const KEY = 'otogi-arena-token';
  try {
    let t = localStorage.getItem(KEY);
    if (!t) {
      t = `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(KEY, t);
    }
    return t;
  } catch {
    return `t${Math.random().toString(36).slice(2)}`;
  }
}

export class NetClient {
  ws?: WebSocket;
  /** サーバー時刻 - クライアント時刻（ms） */
  offset = 0;
  rtt = 0;
  private bestRtt = Infinity;
  private pingTimer = 0;
  private handlers: ((m: ServerMsg) => void)[] = [];
  private closeHandlers: ((unexpected: boolean) => void)[] = [];
  private closing = false;
  /** 送信の記録（テスト・デバッグ用：入力しか送っていないことの確認） */
  sentKinds: Record<string, number> = {};

  constructor(
    public url: string,
    public hello: HelloMsg,
  ) {}

  connect(timeoutMs = 4000): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          ws.close();
          reject(new Error('timeout'));
        }
      }, timeoutMs);
      ws.onopen = () => {
        done = true;
        clearTimeout(timer);
        this.send(this.hello);
        this.ping();
        this.pingTimer = window.setInterval(() => this.ping(), 1000);
        resolve();
      };
      ws.onerror = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(new Error('connect failed'));
        }
      };
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(ev.data as string) as ServerMsg;
        } catch {
          return;
        }
        if (m.k === 'pong') {
          const now = performance.now();
          const rtt = now - m.t;
          this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
          // 一番速かった往復を基準に時計を合わせる（RTT/2 で推定）
          if (rtt <= this.bestRtt * 1.2) {
            this.bestRtt = Math.min(this.bestRtt, rtt);
            this.offset = m.st + rtt / 2 - now;
          }
          return;
        }
        for (const h of this.handlers) h(m);
      };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        for (const h of this.closeHandlers) h(!this.closing);
      };
    });
  }

  on(h: (m: ServerMsg) => void) {
    this.handlers.push(h);
  }
  onClose(h: (unexpected: boolean) => void) {
    this.closeHandlers.push(h);
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.sentKinds[m.k] = (this.sentKinds[m.k] ?? 0) + 1;
    this.ws.send(JSON.stringify(m));
  }

  private ping() {
    this.send({ k: 'ping', t: performance.now() });
  }

  /** サーバー時刻の推定（ms）。 */
  serverNow() {
    return performance.now() + this.offset;
  }

  close() {
    this.closing = true;
    clearInterval(this.pingTimer);
    this.send({ k: 'leave' });
    this.ws?.close();
  }
}

/** ローカルのコマンド（入力UIが作る）→ 送信用の入力。位置・HP・MP は含めない。 */
export function commandToInput(seq: number, move: { x: number; y: number }, c: Command | undefined): InputCmd {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const cmd: InputCmd = { seq, t: Math.round(performance.now()), move: { x: r2(move.x), y: r2(move.y) }, buttons: 0 };
  if (!c) return cmd;
  switch (c.t) {
    case 'ss':
      cmd.buttons = BTN.SS;
      cmd.aim = { x: Math.round(c.x), y: Math.round(c.y) };
      break;
    case 'ds':
      cmd.buttons = BTN.DS;
      cmd.draw = { points: c.pts.flatMap((p) => [Math.round(p.x), Math.round(p.y)]), durMs: Math.round(c.durMs ?? 200) };
      break;
    case 'evade':
      cmd.buttons = BTN.EVADE;
      cmd.dir = { x: r2(c.dx), y: r2(c.dy) };
      break;
    case 'skill':
      cmd.buttons = BTN.CARD;
      cmd.card = c.slot;
      cmd.aim = { x: Math.round(c.x), y: Math.round(c.y) };
      break;
    case 'ws':
      cmd.buttons = BTN.WS;
      cmd.aim = { x: Math.round(c.x), y: Math.round(c.y) };
      break;
  }
  return cmd;
}
