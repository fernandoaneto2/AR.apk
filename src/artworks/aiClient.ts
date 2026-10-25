import type { AIAnalysis } from '../scene/types';

export type AIResult = { ok: true; analysis: AIAnalysis; model: string } | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  'ai-not-configured': 'IA ainda não configurada no servidor (falta a chave da Anthropic). Usamos a análise local.',
  'rate-limited': 'IA ocupada no momento. Usamos a análise local; tente reanalisar depois.',
  refused: 'A IA não pôde analisar esta imagem. Usamos a análise local.',
  'image-too-large': 'Imagem grande demais para a IA. Usamos a análise local.',
  network: 'Sem conexão com a IA. Usamos a análise local.',
};

export const aiErrorMessage = (code: string) => MESSAGES[code] ?? 'A IA falhou. Usamos a análise local.';

/** Envia a imagem (JPEG base64, ~768 px) e métricas locais para /api/analyze. */
export async function analyzeWithAI(imageBase64: string, stats: unknown, signal?: AbortSignal): Promise<AIResult> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, stats }),
      signal,
    });
    const body = (await res.json().catch(() => ({}))) as { analysis?: AIAnalysis; model?: string; error?: string };
    if (!res.ok || !body.analysis) return { ok: false, error: body.error ?? `http-${res.status}` };
    return { ok: true, analysis: body.analysis, model: body.model ?? '' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return { ok: false, error: 'network' };
  }
}
