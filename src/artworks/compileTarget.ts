// Compila a imagem-alvo no próprio navegador com o compilador do MindAR (mesma versão do
// runtime) e extrai os pontos de característica usados para avaliar a rastreabilidade.

export interface FeaturePoint {
  /** Coordenadas normalizadas 0–1 (origem no canto superior esquerdo). */
  x: number;
  y: number;
}

export interface CompiledTarget {
  mind: ArrayBuffer;
  /** Pontos de reconhecimento (detecção) na maior escala compilada. */
  matchingPoints: FeaturePoint[];
  /** Quantidade de pontos de rastreamento (acompanhamento quadro a quadro). */
  trackingPointCount: number;
}

export async function compileTarget(image: HTMLCanvasElement, onProgress: (percent: number) => void): Promise<CompiledTarget> {
  const { Compiler } = await import('mind-ar/dist/mindar-image.prod.js');
  const compiler = new Compiler();
  const [data] = await compiler.compileImageTargets([image], (p) => onProgress(Math.min(100, p)));
  const bytes = compiler.exportData();
  const mind = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  const largest = data.matchingData.reduce((a, b) => (b.width > a.width ? b : a));
  const matchingPoints = [...largest.maximaPoints, ...largest.minimaPoints].map((p) => ({ x: p.x / largest.width, y: p.y / largest.height }));
  const trackingPointCount = data.trackingData.reduce((n, t) => n + t.points.length, 0);
  return { mind, matchingPoints, trackingPointCount };
}

/**
 * Junta vários .mind num só (sem recompilar), para reconhecer qualquer uma das obras
 * cadastradas na mesma sessão. A ordem define o targetIndex.
 */
export async function mergeTargets(buffers: ArrayBuffer[]): Promise<ArrayBuffer> {
  if (buffers.length === 1) return buffers[0];
  const { Compiler } = await import('mind-ar/dist/mindar-image.prod.js');
  const all = buffers.flatMap((b) => new Compiler().importData(b));
  const merged = new Compiler();
  merged.data = all;
  const bytes = merged.exportData();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
