// Análise local (sem rede) da imagem da obra: paleta, contraste, nitidez, distribuição dos
// pontos de reconhecimento → nota de rastreabilidade, dicas e uma cena inicial.

import type { FeaturePoint } from './compileTarget';
import { DEFAULT_SCENE, type Mood, type SceneConfig } from '../scene/types';

export interface ImageStats {
  luminance: number; // 0–255
  contrast: number; // desvio padrão da luminância
  sharpness: number; // variância do Laplaciano (256 px)
  saturation: number; // 0–1
  warmth: number; // -1 (frio) a 1 (quente)
}

export interface QualityReport {
  score: number; // 0–100
  level: 'otima' | 'boa' | 'fraca' | 'ruim';
  featureCount: number;
  trackingPointCount: number;
  coverage: number; // fração da imagem com detalhes reconhecíveis (0–1)
  stats: ImageStats;
  tips: string[];
}

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function pixels(c: HTMLCanvasElement, side: number): ImageData {
  const s = Math.min(1, side / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * s));
  const h = Math.max(1, Math.round(c.height * s));
  const t = document.createElement('canvas');
  t.width = w;
  t.height = h;
  const ctx = t.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Paleta por k-means (k=6) em 64 px, ordenada por presença, sem cores quase iguais. */
export function extractPalette(c: HTMLCanvasElement, k = 6): string[] {
  const { data } = pixels(c, 64);
  const n = data.length / 4;
  const px: number[][] = [];
  for (let i = 0; i < n; i++) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  // Inicialização determinística espalhada pela luminância.
  const sorted = [...px].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centers = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * (sorted.length - 1))]]);
  let counts = new Array(k).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = new Array(k).fill(0);
    for (const p of px) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = (p[0] - centers[j][0]) ** 2 + (p[1] - centers[j][1]) ** 2 + (p[2] - centers[j][2]) ** 2;
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      counts[best]++;
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
    }
    centers = centers.map((c0, j) => (counts[j] ? sums[j].map((s) => s / counts[j]) : c0));
  }
  const order = centers.map((c0, j) => ({ c: c0, n: counts[j] })).sort((a, b) => b.n - a.n);
  const out: number[][] = [];
  for (const { c: c0, n: cnt } of order) {
    if (cnt === 0) continue;
    if (out.some((o) => Math.hypot(o[0] - c0[0], o[1] - c0[1], o[2] - c0[2]) < 28)) continue;
    out.push(c0);
  }
  return out.map((c0) => toHex(c0[0], c0[1], c0[2]));
}

export function imageStats(c: HTMLCanvasElement): ImageStats {
  const { data, width, height } = pixels(c, 256);
  const n = width * height;
  const gray = new Float32Array(n);
  let sum = 0;
  let sat = 0;
  let warm = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = l;
    sum += l;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat += mx === 0 ? 0 : (mx - mn) / mx;
    warm += (r - b) / 255;
  }
  const mean = sum / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (gray[i] - mean) ** 2;
  let lap = 0;
  let lapSq = 0;
  let m = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const L = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      lap += L;
      lapSq += L * L;
      m++;
    }
  }
  return {
    luminance: mean,
    contrast: Math.sqrt(v / n),
    sharpness: lapSq / m - (lap / m) ** 2,
    saturation: sat / n,
    warmth: Math.max(-1, Math.min(1, (warm / n) * 3)),
  };
}

/** Grade de densidade dos pontos (cols × rows). */
function densityGrid(points: FeaturePoint[], cols: number, rows: number): number[] {
  const g = new Array(cols * rows).fill(0);
  for (const p of points) {
    const cx = Math.min(cols - 1, Math.floor(p.x * cols));
    const cy = Math.min(rows - 1, Math.floor(p.y * rows));
    g[cy * cols + cx]++;
  }
  return g;
}

/** Ponto de interesse: região de maior concentração de detalhes (janela 3×3 em grade 8×8). */
export function focusFromFeatures(points: FeaturePoint[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0.5, y: 0.45 };
  const N = 8;
  const g = densityGrid(points, N, N);
  let best = -1;
  let bx = 3;
  let by = 3;
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * N + x + dx];
      if (s > best) {
        best = s;
        bx = x;
        by = y;
      }
    }
  }
  return { x: (bx + 0.5) / N, y: (by + 0.5) / N };
}

// Calibração inicial (ajustar com dados de campo): a arte de exemplo CE-01 gera ~1000+ pontos.
const GOOD_FEATURES = 450;
const GOOD_TRACKING = 300;

export function assessQuality(points: FeaturePoint[], trackingPointCount: number, stats: ImageStats, aspect: number): QualityReport {
  const grid = densityGrid(points, 6, 6);
  const coverage = grid.filter((c) => c >= 3).length / grid.length;
  const fScore = Math.min(1, points.length / GOOD_FEATURES);
  const tScore = Math.min(1, trackingPointCount / GOOD_TRACKING);
  const cScore = Math.min(1, stats.contrast / 55);
  const sScore = Math.min(1, stats.sharpness / 250);
  const score = Math.round(100 * (0.35 * fScore + 0.15 * tScore + 0.25 * coverage + 0.15 * cScore + 0.1 * sScore));

  const tips: string[] = [];
  if (points.length < GOOD_FEATURES * 0.5) tips.push('Poucos detalhes reconhecíveis: obras com texturas, contornos e contraste funcionam melhor que áreas lisas ou degradês.');
  if (coverage < 0.5) tips.push('Os detalhes estão concentrados numa parte da imagem. O reconhecimento fica instável quando a câmera vê só as áreas lisas.');
  if (stats.contrast < 35) tips.push('Contraste baixo: fotografe com luz mais forte e uniforme, ou aumente o contraste da imagem.');
  if (stats.sharpness < 80) tips.push('A foto parece desfocada ou tremida. Refaça com o celular apoiado e foco na obra.');
  if (stats.luminance > 225) tips.push('Imagem muito clara/estourada: evite flash e reflexos sobre a obra.');
  if (stats.luminance < 45) tips.push('Imagem muito escura: fotografe com mais luz.');
  if (aspect > 2.5 || aspect < 0.4) tips.push('Proporção muito alongada: recortes mais próximos de quadrado/retângulo comum reconhecem melhor.');
  if (tips.length === 0) tips.push('Boa imagem para reconhecimento. Na hora de usar, prefira luz uniforme e evite reflexo sobre a obra.');

  const level = score >= 80 ? 'otima' : score >= 60 ? 'boa' : score >= 40 ? 'fraca' : 'ruim';
  return { score, level, featureCount: points.length, trackingPointCount, coverage, stats, tips };
}

function moodFrom(stats: ImageStats): Mood {
  const { luminance: l, saturation: s, warmth: w, contrast: c } = stats;
  if (l < 70) return c > 55 ? 'dramatico' : 'misterioso';
  if (s > 0.5 && w > 0.15) return 'festivo';
  if (s > 0.45) return 'vibrante';
  if (w < -0.1 && s < 0.35) return 'melancolico';
  if (s < 0.25) return 'contemplativo';
  return 'sereno';
}

/** Cena inicial sem IA, derivada das métricas da imagem. */
export function localScene(palette: string[], points: FeaturePoint[], stats: ImageStats): SceneConfig {
  const mood = moodFrom(stats);
  const energy = Math.min(1, Math.max(0.15, stats.saturation * 0.8 + stats.contrast / 200));
  const motion = ({ sereno: 'drift', contemplativo: 'drift', melancolico: 'fall', misterioso: 'swirl', dramatico: 'swirl', vibrante: 'rise', festivo: 'rise' } as const)[mood];
  const shape = ({ sereno: 'circle', contemplativo: 'circle', melancolico: 'circle', misterioso: 'spark', dramatico: 'spark', vibrante: 'spark', festivo: 'petal' } as const)[mood];
  return {
    ...DEFAULT_SCENE,
    palette: palette.length >= 2 ? palette : DEFAULT_SCENE.palette,
    focus: focusFromFeatures(points),
    mood,
    energy,
    effects: {
      layers: { enabled: true, depth: 0.35 + energy * 0.4 },
      particles: { enabled: true, density: 0.3 + energy * 0.5, shape, motion },
      aura: { enabled: true },
      orbit: { enabled: false, shape: 'icosahedron' },
    },
    caption: '',
  };
}
