// Função serverless (Vercel): analisa a imagem de uma obra com Claude e devolve título,
// descrição acessível e a configuração da cena AR. A chave fica só no servidor
// (variável ANTHROPIC_API_KEY no projeto Vercel); o navegador nunca a vê.
//
// Privacidade: recebe apenas a imagem da obra que o usuário escolheu enviar (nunca quadros
// da câmera). Nada é armazenado aqui.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_SCENE, MOODS, ORBIT_SHAPES, PARTICLE_MOTIONS, PARTICLE_SHAPES, sanitizeScene, type AIAnalysis, type SceneConfig } from '../src/scene/types';

const MAX_IMAGE_BYTES = 1_500_000;
const MODEL = 'claude-opus-5-5';

const AnalysisSchema = z.object({
  title: z.string().describe('Título curto sugerido para a obra, em português (até 60 caracteres).'),
  description: z.string().describe('Descrição acessível (texto alternativo) da obra, em português, 1–2 frases.'),
  caption: z.string().describe('Frase curta e poética exibida quando a obra é reconhecida, em português (até 120 caracteres).'),
  mood: z.enum(MOODS as [string, ...string[]]),
  palette: z.array(z.string().describe('Cor hex #rrggbb')).describe('3 a 6 cores dominantes da obra, da mais à menos presente.'),
  focus: z.object({ x: z.number(), y: z.number() }).describe('Ponto de maior interesse visual, normalizado 0–1 (x da esquerda, y do topo).'),
  energy: z.number().describe('Energia das animações de 0 (muito calma) a 1 (muito agitada), coerente com a obra.'),
  effects: z.object({
    layers: z.object({ enabled: z.boolean(), depth: z.number().describe('0–1') }),
    particles: z.object({
      enabled: z.boolean(),
      density: z.number().describe('0–1'),
      shape: z.enum(PARTICLE_SHAPES as [string, ...string[]]),
      motion: z.enum(PARTICLE_MOTIONS as [string, ...string[]]),
    }),
    aura: z.object({ enabled: z.boolean() }),
    orbit: z.object({ enabled: z.boolean(), shape: z.enum(ORBIT_SHAPES as [string, ...string[]]) }),
  }),
  tips: z.array(z.string()).describe('Até 3 dicas práticas, em português, para melhorar o reconhecimento por câmera desta obra/foto.'),
});

const SYSTEM = `Você é curador(a) de arte e diretor(a) de arte de experiências em realidade aumentada (WebAR).
Recebe a imagem de uma obra física (pintura, mural, ilustração, impresso) que será reconhecida pela câmera do celular, e métricas locais de rastreabilidade.
Sua tarefa: entender a obra e configurar efeitos 3D que a ampliem com respeito, sem competir com ela.

Efeitos disponíveis:
- layers: a pintura se separa em camadas por cor que saltam da superfície (parallax). Ótimo para paisagens e obras com planos distintos. depth maior = mais relevo.
- particles: partículas nas cores da obra nascendo dos detalhes. shape: circle (bolhas/luz), petal (flores/natureza), spark (energia/estrelas), square (geométrico/pixel). motion: rise (subir), swirl (redemoinho), fall (cair, ex. chuva/pétalas), drift (deriva lenta, ex. água).
- aura: contorno luminoso e varredura ao reconhecer. Quase sempre útil.
- orbit: um objeto geométrico flutuando sobre o ponto de interesse. Use só se combinar com a obra (ex. arte abstrata/geométrica); em figurativas costuma atrapalhar.

Regras:
- Escolha o que combina com o tema, a técnica e o clima da obra (ex.: lago com nenúfares → layers suave + particles petal/drift, energia baixa).
- palette deve vir da própria imagem.
- focus: onde o olhar vai primeiro.
- Se a obra for de terceiros (famosa), descreva-a normalmente; não invente autoria.
- tips: baseie-se nas métricas fornecidas e no que vê (reflexo, recorte, desfoque, áreas lisas, baixo contraste). Seja concreto.
- Escreva tudo em português do Brasil.`;

type Body = { image?: unknown; stats?: unknown };

async function readJson(req: IncomingMessage, limit: number): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw Object.assign(new Error('payload-too-large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Body;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return send(res, 503, { error: 'ai-not-configured' });

  let body: Body;
  try {
    body = await readJson(req, Math.ceil(MAX_IMAGE_BYTES * 1.4) + 8_000);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    return send(res, status, { error: status === 413 ? 'image-too-large' : 'invalid-json' });
  }

  // Validação: base64 de JPEG (assinatura FF D8 FF) dentro do limite.
  if (typeof body.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.image)) return send(res, 400, { error: 'invalid-image' });
  const bytes = Buffer.from(body.image, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) return send(res, 413, { error: 'image-too-large' });
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return send(res, 400, { error: 'invalid-image' });
  const stats = body.stats && typeof body.stats === 'object' ? JSON.stringify(body.stats).slice(0, 2000) : '{}';

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      // Se o modelo recusar por política, o servidor tenta automaticamente um modelo alternativo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(AnalysisSchema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.image } },
            { type: 'text', text: `Métricas locais de rastreabilidade (JSON): ${stats}\n\nAnalise a obra e configure a cena.` },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') return send(res, 422, { error: 'refused' });
    const out = response.parsed_output;
    if (!out) return send(res, 502, { error: 'unparseable' });

    const scene = sanitizeScene(out as Partial<SceneConfig>, DEFAULT_SCENE);
    const analysis: AIAnalysis = {
      title: String(out.title).slice(0, 80),
      description: String(out.description).slice(0, 400),
      caption: scene.caption,
      mood: scene.mood,
      palette: scene.palette,
      focus: scene.focus,
      energy: scene.energy,
      effects: scene.effects,
      tips: (out.tips ?? []).slice(0, 3).map((t) => String(t).slice(0, 200)),
    };
    return send(res, 200, { analysis, model: response.model });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'rate-limited' });
    if (err instanceof Anthropic.AuthenticationError) return send(res, 503, { error: 'ai-not-configured' });
    if (err instanceof Anthropic.BadRequestError) {
      console.error('[analyze] bad request', err.message);
      return send(res, 400, { error: 'bad-request' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('[analyze] API error', err.status, err.message);
      return send(res, 502, { error: 'upstream' });
    }
    console.error('[analyze] erro', err);
    return send(res, 500, { error: 'internal' });
  }
}
