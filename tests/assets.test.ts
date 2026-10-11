import { describe, expect, it } from 'vitest';
import { ASSETS } from '../src/config/assets';
import { getImage } from '../src/render/assets';

describe('M11 アセット', () => {
  it('マニフェストが空でも getImage は undefined（ベクター描画にフォールバック）', () => {
    for (const group of Object.keys(ASSETS) as (keyof typeof ASSETS)[]) {
      for (const key of Object.keys(ASSETS[group])) {
        expect((ASSETS[group] as Record<string, string>)[key]).toBe('');
        expect(getImage(group, key)).toBeUndefined();
      }
    }
  });
});
