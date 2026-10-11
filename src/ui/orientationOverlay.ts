// 縦持ちのとき「端末を横にしてください」を出す。縦画面フォールバックも壊さない（閉じればそのまま遊べる）。
import { orient } from '../input/orientation';

let el: HTMLDivElement | null = null;
let dismissed = false;

export function updateOrientationOverlay(root: HTMLElement, inGame: boolean) {
  const show = inGame && !orient.land && !dismissed;
  if (show && !el) {
    el = document.createElement('div');
    el.className = 'rotate-overlay interactive';
    el.innerHTML = `<div class="rotate-icon">📱↻</div><p>端末を<b>横</b>にしてください</p>
      <button class="btn" data-act="keep">このまま縦で遊ぶ</button>`;
    el.querySelector('[data-act=keep]')!.addEventListener('click', () => {
      dismissed = true;
      updateOrientationOverlay(root, inGame);
    });
    root.appendChild(el);
  } else if (!show && el) {
    el.remove();
    el = null;
  }
}
