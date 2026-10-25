// Configuração de cena AR por obra. Produzida pela análise local e, quando disponível,
// refinada pela IA (api/analyze.ts). Só tipos e funções puras: usado no app e no servidor.

export type Mood = 'sereno' | 'vibrante' | 'misterioso' | 'melancolico' | 'festivo' | 'dramatico' | 'contemplativo';
export type ParticleShape = 'circle' | 'petal' | 'spark' | 'square';
export type ParticleMotion = 'rise' | 'swirl' | 'fall' | 'drift';
export type OrbitShape = 'icosahedron' | 'torus' | 'sphere' | 'cube';

export interface SceneConfig {
  /** Cores da obra em hex (#rrggbb), da mais à menos presente. */
  palette: string[];
  /** Ponto de interesse normalizado (0–1, origem no canto superior esquerdo da imagem). */
  focus: { x: number; y: number };
  mood: Mood;
  /** Intensidade geral das animações (0–1). */
  energy: number;
  effects: {
    /** A própria pintura se separa em camadas que saltam da superfície. */
    layers: { enabled: boolean; depth: number };
    /** Partículas nas cores da obra, nascendo dos detalhes. */
    particles: { enabled: boolean; density: number; shape: ParticleShape; motion: ParticleMotion };
    /** Brilho no contorno + varredura ao reconhecer. */
    aura: { enabled: boolean };
    /** Objeto 3D flutuando sobre o ponto de interesse. */
    orbit: { enabled: boolean; shape: OrbitShape };
  };
  /** Frase curta exibida na tela quando a obra é reconhecida. */
  caption: string;
}

export interface AIAnalysis {
  title: string;
  description: string;
  caption: string;
  mood: Mood;
  palette: string[];
  focus: { x: number; y: number };
  energy: number;
  effects: SceneConfig['effects'];
  /** Dicas para melhorar o reconhecimento (foto, luz, enquadramento). */
  tips: string[];
}

export const MOODS: readonly Mood[] = ['sereno', 'vibrante', 'misterioso', 'melancolico', 'festivo', 'dramatico', 'contemplativo'];
export const PARTICLE_SHAPES: readonly ParticleShape[] = ['circle', 'petal', 'spark', 'square'];
export const PARTICLE_MOTIONS: readonly ParticleMotion[] = ['rise', 'swirl', 'fall', 'drift'];
export const ORBIT_SHAPES: readonly OrbitShape[] = ['icosahedron', 'torus', 'sphere', 'cube'];

const clamp01 = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

/** Normaliza qualquer objeto (ex.: vindo da rede ou do IndexedDB) para uma SceneConfig válida. */
export function sanitizeScene(input: Partial<SceneConfig> | undefined, base: SceneConfig): SceneConfig {
  const s = input ?? {};
  const e = s.effects ?? base.effects;
  const palette = Array.isArray(s.palette) ? s.palette.filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 6) : [];
  return {
    palette: palette.length >= 2 ? palette : base.palette,
    focus: { x: clamp01(s.focus?.x, base.focus.x), y: clamp01(s.focus?.y, base.focus.y) },
    mood: oneOf(s.mood, MOODS, base.mood),
    energy: clamp01(s.energy, base.energy),
    effects: {
      layers: { enabled: e.layers?.enabled ?? base.effects.layers.enabled, depth: clamp01(e.layers?.depth, base.effects.layers.depth) },
      particles: {
        enabled: e.particles?.enabled ?? base.effects.particles.enabled,
        density: clamp01(e.particles?.density, base.effects.particles.density),
        shape: oneOf(e.particles?.shape, PARTICLE_SHAPES, base.effects.particles.shape),
        motion: oneOf(e.particles?.motion, PARTICLE_MOTIONS, base.effects.particles.motion),
      },
      aura: { enabled: e.aura?.enabled ?? base.effects.aura.enabled },
      orbit: { enabled: e.orbit?.enabled ?? base.effects.orbit.enabled, shape: oneOf(e.orbit?.shape, ORBIT_SHAPES, base.effects.orbit.shape) },
    },
    caption: typeof s.caption === 'string' ? s.caption.slice(0, 160) : base.caption,
  };
}

export const DEFAULT_SCENE: SceneConfig = {
  palette: ['#2bb3a8', '#e4572e', '#f2c14e', '#5b5f97'],
  focus: { x: 0.5, y: 0.45 },
  mood: 'vibrante',
  energy: 0.6,
  effects: {
    layers: { enabled: true, depth: 0.6 },
    particles: { enabled: true, density: 0.6, shape: 'circle', motion: 'rise' },
    aura: { enabled: true },
    orbit: { enabled: false, shape: 'icosahedron' },
  },
  caption: '',
};
