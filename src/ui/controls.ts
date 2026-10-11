// 右下の操作UI（回避ボタン・カード）。キャンバスとは別レイヤ（pointer-events 有り）。
import type { InputManager } from '../input/touch';
import type { Hero } from '../../shared/sim/units/hero';
import type { Camera } from '../render/camera';
import type { PingKind } from '../../shared/sim/world';
import { ASSETS } from '../../shared/config/assets';
import { assetUrl } from '../render/assets';

const PING_ICON = { gather: 'iconFlag', retreat: 'iconArrow', caution: 'iconAlert', enemy: 'iconExtra' } as const;

export class Controls {
  root: HTMLDivElement;
  private evadeBtn: HTMLButtonElement;
  private evadeCd: HTMLDivElement;
  private resetBtn: HTMLButtonElement;
  private lookTag: HTMLDivElement;
  onReset?: () => void;
  getCamera?: () => Camera;
  getMinimapRect?: () => { x: number; y: number; w: number; h: number };

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
      const icon = assetUrl(ASSETS.ui[PING_ICON[kind]]);
      b.innerHTML = icon ? `<img src="${icon}" alt=""/><span>${label}</span>` : label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const h = this.getHero();
        if (h) onPing?.(kind, h.x, h.y);
      });
      pings.appendChild(b);
    }
    this.root.appendChild(pings);
    // カメラリセット（ミニマップの下）
    this.resetBtn = document.createElement('button');
    this.resetBtn.className = 'cam-reset interactive';
    this.resetBtn.title = 'カメラを自キャストへ戻す';
    this.resetBtn.innerHTML = '<span>⌖</span>';
    this.resetBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onReset?.();
    });
    this.root.appendChild(this.resetBtn);
    this.lookTag = document.createElement('div');
    this.lookTag.className = 'look-tag';
    this.root.appendChild(this.lookTag);
    parent.appendChild(this.root);
  }

  update() {
    const r = this.getMinimapRect?.();
    if (r) {
      this.resetBtn.style.top = `${r.y + r.h + 6}px`;
      this.resetBtn.style.left = `${r.x + r.w / 2 - 22}px`;
    }
    const cam = this.getCamera?.();
    const panned = !!cam?.panned;
    this.resetBtn.classList.toggle('on', panned);
    this.lookTag.style.display = panned ? 'block' : 'none';
    if (cam && panned) this.lookTag.textContent = cam.offsetY < 0 ? '▲ 奥（敵陣）を見ています' : '▼ 手前（自陣）を見ています';
    const h = this.getHero();
    if (!h) return;
    const frac = h.evadeCd > 0 ? h.evadeCd / 1.4 : 0;
    this.evadeCd.style.height = `${frac * 100}%`;
  }

  destroy() {
    this.root.remove();
  }
}
