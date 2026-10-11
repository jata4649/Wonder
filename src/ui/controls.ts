// 右下の操作UI（回避ボタン・カード）。キャンバスとは別レイヤ（pointer-events 有り）。
import type { InputManager } from '../input/touch';
import type { Hero } from '../sim/units/hero';

export class Controls {
  root: HTMLDivElement;
  private evadeBtn: HTMLButtonElement;
  private evadeCd: HTMLDivElement;

  constructor(parent: HTMLElement, private input: InputManager, private getHero: () => Hero | undefined) {
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
