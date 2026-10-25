// Visão unificada das obras disponíveis: a obra de exemplo (arquivos em public/) e as
// cadastradas pelo usuário (IndexedDB).

import { ARTWORK } from '../config';
import { DEFAULT_SCENE, type SceneConfig } from '../scene/types';
import type { QualityReport } from './analyze';
import { listArtworks, type StoredArtwork } from './store';

export interface ArtworkEntry {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  width: number;
  height: number;
  scene: SceneConfig;
  featurePoints: Array<{ x: number; y: number }>;
  quality?: QualityReport;
  builtin: boolean;
  stored?: StoredArtwork;
  loadMind(): Promise<ArrayBuffer>;
}

export const EXAMPLE_ID = 'exemplo-ce01';

export const exampleEntry: ArtworkEntry = {
  id: EXAMPLE_ID,
  name: ARTWORK.title,
  description: ARTWORK.description,
  imageUrl: ARTWORK.imageUrl,
  width: 1200,
  height: 1600,
  builtin: true,
  featurePoints: [],
  scene: {
    ...DEFAULT_SCENE,
    palette: ['#2bb3a8', '#e4572e', '#f2c14e', '#5b5f97', '#1f6f6b'],
    focus: { x: 0.5, y: 0.42 },
    mood: 'vibrante',
    energy: 0.65,
    effects: {
      layers: { enabled: true, depth: 0.55 },
      particles: { enabled: true, density: 0.5, shape: 'square', motion: 'rise' },
      aura: { enabled: true },
      orbit: { enabled: true, shape: 'icosahedron' },
    },
    caption: 'Formas e linhas se desprendem do papel.',
  },
  async loadMind() {
    const res = await fetch(ARTWORK.targetUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  },
};

let objectUrls: string[] = [];

export function fromStored(a: StoredArtwork): ArtworkEntry {
  const url = URL.createObjectURL(a.image);
  objectUrls.push(url);
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    imageUrl: url,
    width: a.width,
    height: a.height,
    scene: a.scene,
    featurePoints: a.featurePoints,
    quality: a.quality,
    builtin: false,
    stored: a,
    loadMind: async () => a.mind,
  };
}

/** Lista as obras: cadastradas (mais recentes primeiro) e, por último, a de exemplo. */
export async function listEntries(): Promise<ArtworkEntry[]> {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
  const stored = await listArtworks();
  return [...stored.map(fromStored), exampleEntry];
}

/** Limite de obras reconhecidas ao mesmo tempo (cada alvo a mais deixa a detecção mais lenta). */
export const MAX_SIMULTANEOUS_TARGETS = 8;
