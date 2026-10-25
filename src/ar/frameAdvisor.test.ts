import { describe, expect, it } from 'vitest';
import { decideHint, measureFrame, type FrameMetrics } from './frameAdvisor';

const base: FrameMetrics = { luminance: 130, blown: 0, motion: 2, sharpness: 300 };

describe('decideHint', () => {
  it('prioriza escuro, depois reflexo, depois tremor', () => {
    expect(decideHint({ ...base, luminance: 30, blown: 0.2, motion: 40 }, 1)).toBe('dark');
    expect(decideHint({ ...base, blown: 0.2, motion: 40 }, 1)).toBe('glare');
    expect(decideHint({ ...base, motion: 40 }, 1)).toBe('shaky');
  });

  it('só acusa desfoque após um tempo procurando', () => {
    expect(decideHint({ ...base, sharpness: 5 }, 1)).toBeNull();
    expect(decideHint({ ...base, sharpness: 5 }, 3)).toBe('blurry');
  });

  it('com câmera boa, orienta enquadramento e depois sugere que a obra pode não estar cadastrada', () => {
    expect(decideHint(base, 1)).toBeNull();
    expect(decideHint(base, 5)).toBe('frame-it');
    expect(decideHint(base, 13)).toBe('not-registered');
  });
});

describe('measureFrame', () => {
  it('mede luminância, estouro e movimento', () => {
    const a = new Float32Array(96 * 72).fill(250);
    const b = new Float32Array(96 * 72).fill(200);
    const m = measureFrame(a, b);
    expect(m.luminance).toBe(250);
    expect(m.blown).toBe(1);
    expect(m.motion).toBe(50);
    expect(m.sharpness).toBeCloseTo(0);
  });
});
