// タイトル＆編成画面：キャスト選択 → スキル5つから3つ装備 → アシスト4枠 → ソウル → 難易度。
import { ASSISTS, SOULS } from '../../config/assists';
import { CASTERS, CASTER_BY_ID } from '../../config/casters';
import { saveSettings, settings, teamColor } from '../../config/settings';
import type { Difficulty, Loadout } from '../../config/types';

const KEY = 'otogi-arena-loadout';
const ROLE_LABEL = { fighter: 'ファイター', attacker: 'アタッカー', support: 'サポーター' } as const;
const TYPE_LABEL = { curve: '軌道弾', leap: '突進（跳躍）', charge: '突進（突撃）', lob: '投擲弾' } as const;
const SLOT_LABEL = { weapon: '武器', armor: '防具', tool: '道具', accessory: '装飾', soul: 'ソウル' } as const;

export interface TitleResult {
  loadout: Loadout;
  difficulty: Difficulty;
}

export function defaultLoadout(casterId: string): Loadout {
  const c = CASTER_BY_ID[casterId] ?? CASTERS[0];
  return {
    casterId: c.id,
    skillIds: c.skills.slice(0, 3).map((s) => s.id),
    assistIds: ['as_woodsword', 'as_leather', 'as_feather', 'as_steelsword'],
    soulId: SOULS[0].id,
  };
}

function loadSaved(): TitleResult {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as TitleResult;
      if (CASTER_BY_ID[v.loadout.casterId]) return v;
    }
  } catch {
    /* ignore */
  }
  return { loadout: defaultLoadout('akazukin'), difficulty: 'normal' };
}

export function showTitle(root: HTMLElement, onStart: (r: TitleResult) => void) {
  const state = loadSaved();
  const el = document.createElement('div');
  el.className = 'screen title interactive';
  root.appendChild(el);

  const render = () => {
    const lo = state.loadout;
    const c = CASTER_BY_ID[lo.casterId];
    const d = c.draw;
    el.innerHTML = `
      <div class="panel wide">
        <div class="logo">おとぎアリーナ<small>縦型3レーン・ドローショット対戦</small></div>
        <h2>キャスト</h2>
        <div class="grid casters">
          ${CASTERS.map(
            (x) => `<button class="pick ${x.id === lo.casterId ? 'on' : ''}" data-caster="${x.id}">
              <span class="glyph" style="background:${x.color};color:${x.accent}">${x.glyph}</span>
              <span>${x.name}</span><small>${ROLE_LABEL[x.role]}</small></button>`,
          ).join('')}
        </div>
        <div class="desc">
          <b>${c.name}</b>（${ROLE_LABEL[c.role]} / ${TYPE_LABEL[d.type]}）<br/>${c.desc}
          <div class="params">射程 ${d.range}${d.type === 'curve' ? ` / 描線長 ${d.drawLength} / 弾速 ${d.baseSpeed}（直線×${d.speedUpStraight}・鋭角×${d.speedDownSharp}）` : ''}${d.multiShot > 1 ? ` / ${d.multiShot}発` : ''}${d.down ? '' : ' / 非ダウン'}</div>
        </div>
        <h2>スキル <small>${lo.skillIds.length}/3 装備</small></h2>
        <div class="grid skills">
          ${c.skills
            .map(
              (s) => `<button class="pick ${lo.skillIds.includes(s.id) ? 'on' : ''}" data-skill="${s.id}">
              <span class="glyph">${s.glyph}</span><span>${s.name}</span>
              <small>MP${s.mpCost} / CD${s.cooldown}s / Lv${s.requiredLevel}</small><small>${s.desc ?? ''}</small></button>`,
            )
            .join('')}
        </div>
        <div class="desc">WS：<b>${c.wonderSkill.glyph} ${c.wonderSkill.name}</b> — ${c.wonderSkill.desc}（1試合1回・MP0・Lv5で解禁）</div>
        <h2>アシスト <small>${lo.assistIds.length}/4（4枠目はLv6以上で発動）</small></h2>
        <div class="grid assists">
          ${ASSISTS.map((a) => {
            const idx = lo.assistIds.indexOf(a.id);
            return `<button class="pick ${idx >= 0 ? 'on' : ''}" data-assist="${a.id}">
              <span>${idx >= 0 ? `<i>${idx + 1}</i>` : ''}${a.name}</span><small>${SLOT_LABEL[a.slot]} / Lv${a.requiredLevel}</small><small>${a.desc ?? ''}</small></button>`;
          }).join('')}
        </div>
        <h2>ソウル</h2>
        <div class="grid souls">
          ${SOULS.map(
            (s) => `<button class="pick ${s.id === lo.soulId ? 'on' : ''}" data-soul="${s.id}"><span>${s.name}</span><small>${s.desc ?? ''}</small></button>`,
          ).join('')}
        </div>
        <h2>難易度（AI）</h2>
        <div class="grid diff">
          ${(['easy', 'normal', 'hard'] as Difficulty[])
            .map((x) => `<button class="pick ${x === state.difficulty ? 'on' : ''}" data-diff="${x}">${{ easy: 'かんたん', normal: 'ふつう', hard: 'むずかしい' }[x]}</button>`)
            .join('')}
        </div>
        <label class="opt"><input type="checkbox" data-opt="swap" ${settings.swapColors ? 'checked' : ''}/> 陣営カラーを反転（自軍 <span style="color:${teamColor(0)}">■</span>）</label>
        <label class="opt"><input type="checkbox" data-opt="fps" ${settings.showFps ? 'checked' : ''}/> FPSを表示</label>
        <div class="buttons sticky"><button class="btn primary" data-act="start">出撃（4 vs 4）</button></div>
        <details class="howto"><summary>操作方法</summary>
          <ul>
            <li>画面<b>左半分</b>：触れた場所にスティックが出て移動</li>
            <li>画面<b>右半分</b>：触れると構え、なぞって離すと<b>ドローショット</b>。短タップでオート照準の<b>ストレートショット</b></li>
            <li>自キャストに指を戻して離す／<b>避</b>ボタンでキャンセル。描線長を超えると自動発動</li>
            <li>同じ側に2本指でカメラ移動（放置で自動復帰）。ミニマップはタップで拡大</li>
            <li>PC：WASD 移動・Space 回避・マウスで右半分をドラッグ</li>
          </ul>
        </details>
      </div>`;
  };

  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button, input') as HTMLElement | null;
    if (!t) return;
    const lo = state.loadout;
    if (t.dataset.caster) {
      const keepAssists = lo.assistIds;
      const keepSoul = lo.soulId;
      state.loadout = { ...defaultLoadout(t.dataset.caster), assistIds: keepAssists, soulId: keepSoul };
    } else if (t.dataset.skill) {
      const id = t.dataset.skill;
      if (lo.skillIds.includes(id)) lo.skillIds = lo.skillIds.filter((x) => x !== id);
      else if (lo.skillIds.length < 3) lo.skillIds.push(id);
      else lo.skillIds = [...lo.skillIds.slice(1), id];
    } else if (t.dataset.assist) {
      const id = t.dataset.assist;
      if (lo.assistIds.includes(id)) lo.assistIds = lo.assistIds.filter((x) => x !== id);
      else if (lo.assistIds.length < 4) lo.assistIds.push(id);
    } else if (t.dataset.soul) {
      lo.soulId = t.dataset.soul;
    } else if (t.dataset.diff) {
      state.difficulty = t.dataset.diff as Difficulty;
    } else if (t.dataset.opt === 'swap') {
      settings.swapColors = (t as HTMLInputElement).checked;
      saveSettings();
    } else if (t.dataset.opt === 'fps') {
      settings.showFps = (t as HTMLInputElement).checked;
      saveSettings();
    } else if (t.dataset.act === 'start') {
      if (lo.skillIds.length === 0) lo.skillIds = CASTER_BY_ID[lo.casterId].skills.slice(0, 3).map((s) => s.id);
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* ignore */
      }
      el.remove();
      onStart({ loadout: { ...lo, skillIds: [...lo.skillIds], assistIds: [...lo.assistIds] }, difficulty: state.difficulty });
      return;
    } else return;
    const scroll = el.scrollTop;
    render();
    el.scrollTop = scroll;
  });
  render();
}
