import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SDK simulado: captura os parâmetros enviados e devolve a resposta configurada no teste.
const parse = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500;
  }
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class BadRequestError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static AuthenticationError = AuthenticationError;
    static BadRequestError = BadRequestError;
    beta = { messages: { parse } };
  }
  return { default: Anthropic };
});

const { default: handler } = await import('../../api/analyze');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]).toString('base64');

function call(method: string, body?: unknown) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]) as unknown as IncomingMessage;
  req.method = method;
  const res = { statusCode: 0, headers: {} as Record<string, string>, body: '' } as unknown as ServerResponse & { body: string };
  res.setHeader = ((k: string, v: string) => ((res as unknown as { headers: Record<string, string> }).headers[k] = v)) as never;
  res.end = ((chunk: string) => ((res as unknown as { body: string }).body = chunk)) as never;
  return handler(req, res).then(() => ({ status: res.statusCode, json: JSON.parse((res as unknown as { body: string }).body) }));
}

describe('api/analyze', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    parse.mockReset();
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('recusa métodos que não são POST', async () => {
    expect((await call('GET')).status).toBe(405);
  });

  it('responde 503 quando a chave não está configurada (app usa análise local)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await call('POST', { image: JPEG });
    expect(r).toEqual({ status: 503, json: { error: 'ai-not-configured' } });
  });

  it('valida a imagem: base64 inválido e arquivo que não é JPEG', async () => {
    expect((await call('POST', { image: '***' })).status).toBe(400);
    expect((await call('POST', { image: Buffer.from('GIF89a....').toString('base64') })).json.error).toBe('invalid-image');
    expect((await call('POST', 'não é json')).json.error).toBe('invalid-json');
    expect(parse).not.toHaveBeenCalled();
  });

  it('chama Claude com imagem, saída estruturada e fallback; saneia a resposta', async () => {
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      model: 'claude-opus-5-5',
      parsed_output: {
        title: 'Lago',
        description: 'Um lago.',
        caption: 'Água e luz.',
        mood: 'sereno',
        palette: ['#112233', 'vermelho', '#abcdef'],
        focus: { x: 1.7, y: -2 },
        energy: 0.3,
        effects: {
          layers: { enabled: true, depth: 5 },
          particles: { enabled: true, density: 0.5, shape: 'petal', motion: 'drift' },
          aura: { enabled: true },
          orbit: { enabled: false, shape: 'sphere' },
        },
        tips: ['a', 'b', 'c', 'd'],
      },
    });
    const r = await call('POST', { image: JPEG, stats: { nota: 80 } });
    expect(r.status).toBe(200);
    const params = parse.mock.calls[0][0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toContain('server-side-fallback-2026-07-01');
    expect(params.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    const a = r.json.analysis;
    expect(a.palette).toEqual(['#112233', '#abcdef']);
    expect(a.focus).toEqual({ x: 1, y: 0 });
    expect(a.effects.layers.depth).toBe(1);
    expect(a.tips).toHaveLength(3);
  });

  it('trata recusa do modelo', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });
    expect((await call('POST', { image: JPEG })).json.error).toBe('refused');
  });
});
