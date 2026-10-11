// オンラインの待機画面：接続中 → マッチング待ち（30秒で CPU 補充）／ルーム待機 → 開始。
// サーバーに繋がらないときは CPU 戦へ切り替えられる（オフラインでも遊べる）。
import type { ServerMsg } from '../../../shared/net/protocol';

export class LobbyScreen {
  el: HTMLDivElement;
  private status: HTMLDivElement;

  constructor(
    root: HTMLElement,
    private handlers: { onCancel: () => void; onStartRoom: () => void; onOffline: () => void },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen lobby interactive';
    this.el.innerHTML = `<div class="panel"><h2>オンライン</h2><div class="status"></div>
      <div class="buttons"><button class="btn" data-act="cancel">やめる</button></div></div>`;
    this.status = this.el.querySelector('.status')!;
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'cancel') this.handlers.onCancel();
      if (act === 'start') this.handlers.onStartRoom();
      if (act === 'offline') this.handlers.onOffline();
    });
    root.appendChild(this.el);
    this.set('<div class="big">接続中…</div>');
  }

  set(html: string) {
    this.status.innerHTML = html;
  }

  update(m: ServerMsg) {
    if (m.k === 'lobby') {
      if (m.mode === 'room') {
        this.set(`<div>ルームコード</div><div class="big">${m.roomCode}</div>
          <div>参加者 ${m.humans} / 8（足りない枠は CPU）</div>
          ${m.host ? '<div class="buttons"><button class="btn primary" data-act="start">この人数で開始</button></div>' : '<div>ホストの開始を待っています…</div>'}`);
      } else {
        const left = Math.max(0, Math.ceil((m.limitMs - m.waitedMs) / 1000));
        const pct = Math.min(100, (m.waitedMs / m.limitMs) * 100);
        this.set(`<div class="big">対戦相手を探しています</div>
          <div>待機中 ${m.waiting} 人（レートの近い人を優先）</div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div>あと ${left} 秒で CPU を補充して開始します</div>`);
      }
    } else if (m.k === 'error') {
      this.set(`<div class="big">⚠ ${m.msg}</div>`);
    }
  }

  offline(reason: string) {
    this.set(`<div class="big">サーバーに接続できません</div><div>${reason}</div>
      <div class="buttons"><button class="btn primary" data-act="offline">CPU戦で遊ぶ（オフライン）</button></div>`);
  }

  destroy() {
    this.el.remove();
  }
}
