import { describe, expect, it } from 'vitest';
import { assessQuality, focusFromFeatures, localScene, type ImageStats } from './analyze';
import { homography, type Quad } from './imageTools';

const good: ImageStats = { luminance: 130, contrast: 60, sharpness: 400, saturation: 0.5, warmth: 0.1 };
const grid = (n: number) => Array.from({ length: n }, (_, i) => ({ x: ((i * 37) % 100) / 100, y: ((i * 61) % 100) / 100 }));

describe('assessQuality', () => {
  it('nota alta para muitos pontos bem distribuídos e boa imagem', () => {
    const q = assessQuality(grid(900), 600, good, 1.33);
    expect(q.score).toBeGreaterThanOrEqual(80);
    expect(q.level).toBe('otima');
  });

  it('nota baixa e dicas concretas para imagem lisa, escura e borrada', () => {
    const corner = Array.from({ length: 60 }, (_, i) => ({ x: (i % 10) / 50, y: Math.floor(i / 10) / 50 }));
    const q = assessQuality(corner, 40, { luminance: 30, contrast: 15, sharpness: 20, saturation: 0.1, warmth: 0 }, 1);
    expect(q.score).toBeLessThan(40);
    expect(q.tips.join(' ')).toMatch(/Poucos detalhes/);
    expect(q.tips.join(' ')).toMatch(/concentrados/);
    expect(q.tips.join(' ')).toMatch(/escura/);
  });
});

describe('focusFromFeatures', () => {
  it('aponta para a região com mais detalhes', () => {
    const pts = [...grid(50), ...Array.from({ length: 300 }, () => ({ x: 0.8, y: 0.2 }))];
    const f = focusFromFeatures(pts);
    expect(f.x).toBeGreaterThan(0.6);
    expect(f.y).toBeLessThan(0.4);
  });
});

describe('localScene', () => {
  it('imagem escura e contrastada vira cena dramática com redemoinho', () => {
    const s = localScene(['#000000', '#ffffff'], [], { luminance: 50, contrast: 70, sharpness: 300, saturation: 0.2, warmth: 0 });
    expect(s.mood).toBe('dramatico');
    expect(s.effects.particles.motion).toBe('swirl');
  });
});

describe('homography', () => {
  it('mapeia os 4 cantos exatamente', () => {
    const from: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }];
    const to: Quad = [{ x: 12, y: 8 }, { x: 90, y: 15 }, { x: 95, y: 160 }, { x: 5, y: 140 }];
    const m = homography(from, to);
    for (let i = 0; i < 4; i++) {
      const { x, y } = from[i];
      const z = m[6] * x + m[7] * y + m[8];
      expect((m[0] * x + m[1] * y + m[2]) / z).toBeCloseTo(to[i].x, 6);
      expect((m[3] * x + m[4] * y + m[5]) / z).toBeCloseTo(to[i].y, 6);
    }
  });
});
