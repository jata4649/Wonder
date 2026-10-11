// リザルト画面。
import type { World } from '../sim/world';
import { teamColor } from '../config/settings';
import { ASSETS } from '../config/assets';
import { assetUrl } from '../render/assets';

const iconOf = (id: string) => assetUrl(ASSETS.casters[id]?.icon);

export function showResult(root: HTMLElement, world: World, onRetry: () => void, onTitle?: () => void) {
  const r = world.match.result!;
  const st = world.match.stats;
  const win = r.winner === 0;
  const draw = r.winner === 'draw';
  const title = draw ? 'DRAW' : win ? 'WIN' : 'LOSE';
  const color = draw ? '#ddd' : teamColor(win ? 0 : 1);
  const el = document.createElement('div');
  el.className = 'screen result interactive';
  const g = world.match.gauge;
  const row = (label: string, a: string | number, b: string | number) =>
    `<tr><td>${a}</td><th>${label}</th><td>${b}</td></tr>`;
  el.innerHTML = `
    <div class="panel">
      <h1 style="color:${color}">${title}</h1>
      <p class="sub">${r.reason === 'gauge' ? 'チームゲージ 0' : '時間切れ'}</p>
      <table class="stats">
        <tr><td style="color:${teamColor(0)}">自軍</td><th></th><td style="color:${teamColor(1)}">敵軍</td></tr>
        ${row('残りゲージ', g[0].toFixed(1), g[1].toFixed(1))}
        ${row('拠点破壊', st.baseDestroyed[0], st.baseDestroyed[1])}
        ${row('キャスト撃破', st.heroKills[0], st.heroKills[1])}
        ${row('与ゲージ(拠点破壊)', st.gaugeFrom[0].base.toFixed(1), st.gaugeFrom[1].base.toFixed(1))}
        ${row('与ゲージ(拠点/城ダメ)', st.gaugeFrom[0].damage.toFixed(1), st.gaugeFrom[1].damage.toFixed(1))}
        ${row('与ゲージ(撃破)', st.gaugeFrom[0].kill.toFixed(1), st.gaugeFrom[1].kill.toFixed(1))}
      </table>
      <table class="stats heroes">
        <tr><th>キャスト</th><th>撃破</th><th>撤退</th><th></th><th>キャスト</th><th>撃破</th><th>撤退</th></tr>
        ${[0, 1, 2, 3]
          .map((i) => {
            const a = world.heroes.filter((h) => h.team === 0)[i];
            const b = world.heroes.filter((h) => h.team === 1)[i];
            const cell = (h: typeof a) =>
              h ? `<td>${h.isPlayer ? '★' : ''}${iconOf(h.def.id) ? `<img class="ricon" src="${iconOf(h.def.id)}" alt=""/>` : ''}${h.def.name}</td><td>${h.kills}</td><td>${h.deaths}</td>` : '<td></td><td></td><td></td>';
            return `<tr>${cell(a)}<td></td>${cell(b)}</tr>`;
          })
          .join('')}
      </table>
      <p class="sub">チームレベル 自軍Lv${world.progress[0].level} / 敵軍Lv${world.progress[1].level}</p>
      <div class="buttons">
        <button class="btn primary" data-act="retry">もう一度</button>
        ${onTitle ? '<button class="btn" data-act="title">タイトルへ</button>' : ''}
      </div>
    </div>`;
  el.querySelector('[data-act=retry]')!.addEventListener('click', () => {
    el.remove();
    onRetry();
  });
  el.querySelector('[data-act=title]')?.addEventListener('click', () => {
    el.remove();
    onTitle?.();
  });
  root.appendChild(el);
}
