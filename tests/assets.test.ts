import { describe, expect, it } from 'vitest';
import { ASSETS } from '../shared/config/assets';
import { CASTERS } from '../shared/config/casters';
import { img, resolveAsset } from '../src/render/assets';
import { existsSync } from 'node:fs';

const file = (p: string) => `public${p}`;

describe('M11 アセット', () => {
  it('全キャストに画像セットがあり、マニフェストのファイルが実在する', () => {
    for (const c of CASTERS) {
      const a = ASSETS.casters[c.id];
      expect(a, c.id).toBeDefined();
      for (const k of ['portrait', 'icon'] as const) expect(existsSync(file(a[k])), `${c.id}.${k}`).toBe(true);
      if (a.bust) expect(existsSync(file(a.bust))).toBe(true);
    }
    const paths: string[] = [];
    const walk = (o: unknown) => {
      if (typeof o === 'string') {
        if (o) paths.push(o);
      } else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    };
    walk(ASSETS);
    for (const p of paths) expect(existsSync(file(p)), p).toBe(true);
  });

  it('空文字のキー（sprite・support）は undefined → ベクター描画', () => {
    expect(ASSETS.giants.support.art).toBe('');
    for (const c of Object.values(ASSETS.casters)) expect(img(c.sprite)).toBeUndefined();
  });

  it('dpr>=2 では @2x を優先し、無ければ等倍', () => {
    expect(resolveAsset('/assets/a.png', 2)).toEqual(['./assets/a@2x.png', './assets/a.png']);
    expect(resolveAsset('/assets/a.png', 1)).toEqual(['./assets/a.png']);
  });
});
