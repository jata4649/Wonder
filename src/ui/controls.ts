// 右下の操作UI（回避ボタン・カード）。キャンバスとは別レイヤ（pointer-events 有り）。
import type { InputManager } from '../input/touch';
import type { Hero } from '../sim/units/hero';
import type { PingKind } from '../sim/world';

export class Controls {
  root: HTMLDivElement;
  private evadeBtn: HTMLButtonElement;
  private evadeCd: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private input: InputManager,
    private getHero: () => Hero | undefined,
    onPing?: (kind: PingKind, x: number, y: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'controls';
    this.evadeBtn = document.createElement('button');
    this.evadeBtn.className = 'evade-btn interactive';
    this.evadeBtn.innerHTML = '<span>避</span>';
    this.evadeCd = document.createElement('div');
    this.evadeCd.className = 'cd';
    this.evadeBtn.appendChild(this.evadeCd);
    this.evadeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.input.evade();
    });
    this.root.appendChild(this.evadeBtn);
    // ピング（上部）
    const pings = document.createElement('div');
    pings.className = 'pings';
    for (const [kind, label] of [
      ['gather', '集合'],
      ['retreat', '退却'],
      ['caution', '注意'],
      ['enemy', '敵'],
    ] as [PingKind, string][]) {
      const b = document.createElement('button');
      b.className = 'ping interactive';
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const h = this.getHero();
        if (h) onPing?.(kind, h.x, h.y);
      });
      pings.appendChild(b);
    }
    this.root.appendChild(pings);
    parent.appendChild(this.root);
  }

  update() {
    const h = this.getHero();
    if (!h) return;
    const frac = h.evadeCd > 0 ? h.evadeCd / 1.4 : 0;
    this.evadeCd.style.height = `${frac * 100}%`;
  }

  destroy() {
    this.root.remove();
  }
}
