// Cadastro de uma obra: imagem recortada → análise local → alvo compilado → IA (opcional) → salvo.

import { aiErrorMessage, analyzeWithAI } from './aiClient';
import { assessQuality, extractPalette, imageStats, localScene } from './analyze';
import { compileTarget } from './compileTarget';
import { canvasToBlob, jpegBase64 } from './imageTools';
import { newId, saveArtwork, type StoredArtwork } from './store';
import { sanitizeScene } from '../scene/types';

export type PipelineStep = 'analyze' | 'compile' | 'ai' | 'save';

export interface PipelineOptions {
  name: string;
  useAI: boolean;
  onStep: (step: PipelineStep, progress?: number) => void;
  signal?: AbortSignal;
}

export async function registerArtwork(image: HTMLCanvasElement, opts: PipelineOptions): Promise<StoredArtwork> {
  const check = () => {
    if (opts.signal?.aborted) throw new DOMException('cancelado', 'AbortError');
  };

  opts.onStep('analyze');
  const stats = imageStats(image);
  const palette = extractPalette(image);
  check();

  opts.onStep('compile', 0);
  const compiled = await compileTarget(image, (p) => opts.onStep('compile', p));
  check();

  const quality = assessQuality(compiled.matchingPoints, compiled.trackingPointCount, stats, image.height / image.width);
  let scene = localScene(palette, compiled.matchingPoints, stats);
  let name = opts.name.trim();
  let description = '';
  const ai: StoredArtwork['ai'] = { used: false };

  if (opts.useAI) {
    opts.onStep('ai');
    const result = await analyzeWithAI(
      await jpegBase64(image),
      {
        nota: quality.score,
        pontosDeReconhecimento: quality.featureCount,
        pontosDeRastreamento: quality.trackingPointCount,
        cobertura: Number(quality.coverage.toFixed(2)),
        contraste: Math.round(stats.contrast),
        nitidez: Math.round(stats.sharpness),
        luminancia: Math.round(stats.luminance),
        largura: image.width,
        altura: image.height,
      },
      opts.signal,
    );
    if (result.ok) {
      const a = result.analysis;
      // A IA escolhe estética e ponto de interesse; a análise local cobre o que vier inválido.
      scene = sanitizeScene(a, scene);
      if (!name) name = a.title;
      description = a.description;
      ai.used = true;
      ai.model = result.model;
      ai.tips = a.tips;
    } else {
      ai.error = aiErrorMessage(result.error);
    }
  }
  check();

  opts.onStep('save');
  const now = Date.now();
  const record: StoredArtwork = {
    id: newId(),
    name: name || 'Obra sem título',
    description,
    createdAt: now,
    updatedAt: now,
    image: await canvasToBlob(image, 'image/jpeg', 0.9),
    width: image.width,
    height: image.height,
    mind: compiled.mind,
    featurePoints: compiled.matchingPoints.filter((_, i) => i % Math.max(1, Math.floor(compiled.matchingPoints.length / 400)) === 0),
    quality,
    scene,
    ai,
  };
  await saveArtwork(record);
  return record;
}
