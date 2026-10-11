// 右下のスキルカード（タップで発動）。MP・クールダウン・解禁レベルを表示。
import { XP } from '../config/balance';
import type { SkillDef } from '../config/types';
import { skillReady, wonderReady } from '../sim/effects';
import type { Hero } from '../sim/units/hero';
import type { World } from '../sim/world';
import { ASSETS } from '../config/assets';
import { assetUrl } from '../render/assets';

export class Cards {
  root: HTMLDivElement;
  private cards: { el: HTMLButtonElement; cd: HTMLDivElement; lock: HTMLDivElement; skill: SkillDef; slot: number }[] = [];

  constructor(parent: HTMLElement, private hero: Hero, private world: () => World, onUse?: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'cards';
    const make = (skill: SkillDef, slot: number) => {
      const el = document.createElement('button');
      el.className = `card interactive ${slot < 0 ? 'ws' : ''}`;
      // スキルカード枠（ui/panel_frame.png を流用）
      const frame = assetUrl(ASSETS.ui.panelFrame);
      if (frame) el.style.backgroundImage = `url("${frame}")`;
      el.innerHTML = `<b>${skill.glyph}</b><small>${slot < 0 ? 'WS' : skill.mpCost}</small>`;
      const cd = document.createElement('div');
      cd.className = 'cd';
      const lock = document.createElement('div');
      lock.className = 'lock';
      lock.textContent = `Lv${slot < 0 ? XP.wonderSkillLevel : skill.requiredLevel}`;
      el.append(cd, lock);
      el.title = `${skill.name}：${skill.desc ?? ''}`;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.use(slot);
        onUse?.();
      });
      this.root.appendChild(el);
      this.cards.push({ el, cd, lock, skill, slot });
    };
    hero.skills.forEach((s, i) => make(s, i));
    make(hero.def.wonderSkill, -1);
    parent.appendChild(this.root);
  }

  /** ターゲット：近くの敵キャスト＞近くの敵＞向いている方向。 */
  private target() {
    const h = this.hero;
    const w = this.world();
    const t = w.nearestEnemy(h.x, h.y, h.team, 520, (m) => m.kind === 'hero') ?? w.nearestEnemy(h.x, h.y, h.team, 520);
    if (t) return { x: t.x, y: t.y };
    const fl = Math.hypot(h.faceX, h.faceY) || 1;
    return { x: h.x + (h.faceX / fl) * 300, y: h.y + (h.faceY / fl) * 300 };
  }

  use(slot: number) {
    const t = this.target();
    if (slot < 0) this.hero.cmds.push({ t: 'ws', x: t.x, y: t.y });
    else this.hero.cmds.push({ t: 'skill', slot, x: t.x, y: t.y });
  }

  update() {
    const h = this.hero;
    for (const c of this.cards) {
      if (c.slot < 0) {
        const ready = wonderReady(h);
        c.el.classList.toggle('used', h.wsUsed);
        c.el.classList.toggle('locked', !h.wsUsed && !ready);
        c.el.classList.toggle('ready', ready && h.alive);
        c.cd.style.height = h.wsUsed ? '100%' : '0%';
        continue;
      }
      const r = skillReady(h, c.slot);
      c.el.classList.toggle('locked', r.reason?.startsWith('Lv') ?? false);
      c.el.classList.toggle('nomp', r.reason === 'mp');
      c.el.classList.toggle('ready', r.ok && h.alive);
      c.cd.style.height = h.skillCd[c.slot] > 0 ? `${(h.skillCd[c.slot] / c.skill.cooldown) * 100}%` : '0%';
    }
  }

  destroy() {
    this.root.remove();
  }
}
