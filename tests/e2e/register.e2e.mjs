#!/usr/bin/env node
// E2E do fluxo "cadastre sua obra" sem aparelho físico:
// 1. escolhe tests/fixtures/foto-parede.jpg (obra na parede, em perspectiva) pela galeria;
// 2. confere a detecção automática dos cantos, cria a experiência (compilação no navegador);
// 3. IA simulada (rota /api/analyze interceptada) — ou `--real-ai` para chamar o servidor;
// 4. abre "Apontar para uma obra" com câmera falsa que mostra a obra nova e depois a de exemplo,
//    e verifica que as DUAS são reconhecidas, cada uma com sua legenda.
//
// Pré-requisitos: `npm run build`, ffmpeg, Playwright/Chromium, `python3 tests/fixtures/make-fixtures.py`.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../../scripts/lib/playwright.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'tests/e2e/.artifacts/register');
const VIDEO = resolve(OUT, 'camera-duas-obras.y4m');
const PORT = 4793;
const urlArg = process.argv.indexOf('--url');
const REMOTE = urlArg > -1 ? process.argv[urlArg + 1].replace(/\/$/, '') : null;
const REAL_AI = process.argv.includes('--real-ai');

await mkdir(OUT, { recursive: true });
const PHOTO = resolve(ROOT, 'tests/fixtures/foto-parede.jpg');
const PAINTING = resolve(ROOT, 'tests/fixtures/pintura.jpg');
if (!existsSync(PHOTO)) throw new Error('Rode: python3 tests/fixtures/make-fixtures.py');

if (!existsSync(VIDEO) || process.argv.includes('--regen')) {
  console.log('Gerando vídeo de câmera falsa (pintura 1,5–7 s; exemplo 9,5–16 s)…');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x5f5d58:s=640x480:r=15:d=16',
    '-loop', '1', '-i', PAINTING,
    '-loop', '1', '-i', resolve(ROOT, 'public/images/obra-original.jpg'),
    '-filter_complex',
    "[0]noise=alls=14:allf=t[bg];[1]scale=-2:420,format=yuv420p[a];[2]scale=-2:400,format=yuv420p[b];" +
      "[bg][a]overlay=x='(W-w)/2+20*sin(t*1.1)':y='(H-h)/2':enable='between(t,1.5,7)'[t1];" +
      "[t1][b]overlay=x='(W-w)/2':y='(H-h)/2+8*sin(t)':enable='between(t,9.5,16)':shortest=1,format=yuv420p",
    '-t', '16', VIDEO,
  ]);
}

const server = REMOTE
  ? null
  : spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
if (server) {
  await new Promise((ok, fail) => {
    const t = setTimeout(() => (server.kill(), fail(new Error('vite preview não subiu'))), 30_000);
    server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), ok()));
  });
}
const BASE = REMOTE ?? `http://127.0.0.1:${PORT}`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`, '--ignore-gpu-blocklist'],
});

let failed = false;
const t0 = Date.now();
const log = (m) => console.log(`  ✓ ${m} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await context.grantPermissions(['camera']);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/api\/analyze/.test(m.text()) && errors.push(m.text()));

  let aiCalls = 0;
  if (!REAL_AI) {
    await page.route('**/api/analyze', async (route) => {
      aiCalls++;
      const body = JSON.parse(route.request().postData() ?? '{}');
      if (typeof body.image !== 'string' || body.image.length < 1000) return route.fulfill({ status: 400, body: '{}' });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: 'mock',
          analysis: {
            title: 'Lago com ponte',
            description: 'Pinceladas verdes e azuis formam um lago com nenúfares rosados; uma ponte clara atravessa a cena.',
            caption: 'A ponte flutua sobre o lago.',
            mood: 'sereno',
            palette: ['#2e5a4c', '#6c9a52', '#d6a0c8', '#5a86a8', '#c8d8c0'],
            focus: { x: 0.5, y: 0.6 },
            energy: 0.35,
            effects: {
              layers: { enabled: true, depth: 0.7 },
              particles: { enabled: true, density: 0.6, shape: 'petal', motion: 'drift' },
              aura: { enabled: true },
              orbit: { enabled: false, shape: 'sphere' },
            },
            tips: ['Evite reflexo do verniz.'],
          },
        }),
      });
    });
  }

  await page.goto(`${BASE}/?debug=1#nova`);
  await page.check('#chk-rights');
  await page.setInputFiles('#in-gallery', PHOTO);
  await page.waitForSelector('#step-crop:not([hidden])');
  const cropMsg = await page.textContent('#crop-msg');
  if (!/automaticamente/.test(cropMsg)) throw new Error(`Detecção automática falhou: ${cropMsg}`);
  log('cantos detectados automaticamente');
  await page.screenshot({ path: resolve(OUT, '01-recorte.png') });

  await page.click('#btn-process');
  await page.waitForSelector('#detail:not([hidden])', { timeout: 120_000 });
  const score = Number(await page.textContent('#q-score'));
  const title = await page.textContent('#detail-title');
  log(`obra cadastrada: "${title}", nota ${score}/100, IA chamada ${aiCalls}x`);
  if (!REAL_AI && aiCalls !== 1) throw new Error('IA não foi chamada');
  if (!(score >= 40)) throw new Error(`Nota baixa demais para a pintura de teste: ${score}`);
  await page.screenshot({ path: resolve(OUT, '02-detalhes.png'), fullPage: true });

  await page.click('#btn-detail-demo');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: resolve(OUT, '03-previa.png') });
  await page.click('#btn-close');
  await page.waitForSelector('#detail:not([hidden])');

  // Volta ao início e aponta para "qualquer obra": deve reconhecer as duas, em sequência.
  await page.click('#detail-back');
  await page.waitForSelector('#home:not([hidden])');
  const cards = await page.locator('.art-card').count();
  if (cards !== 2) throw new Error(`Esperava 2 obras na galeria, há ${cards}`);
  await page.click('#btn-scan');

  const seen = new Set();
  const end = Date.now() + 90_000;
  let shot = 0;
  while (Date.now() < end && seen.size < 2) {
    const visible = await page.isVisible('#caption');
    if (visible) {
      const name = (await page.textContent('#caption strong'))?.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        await page.waitForTimeout(900);
        await page.screenshot({ path: resolve(OUT, `0${4 + shot++}-reconhecida.png`) });
        log(`reconhecida: ${name}`);
      }
    }
    const st = await page.evaluate(() => window.__webar.state.state);
    if (st.kind === 'error') throw new Error(`Erro na AR: ${JSON.stringify(st)}`);
    await page.waitForTimeout(150);
  }
  if (seen.size < 2) throw new Error(`Só reconheceu: ${[...seen].join(', ') || 'nenhuma'}`);

  await page.click('#btn-close');
  if ((await page.locator('video').count()) !== 0) throw new Error('Câmera não foi encerrada');
  log('câmera encerrada ao sair');
  const csp = errors.filter((e) => /Content Security Policy/i.test(e));
  if (csp.length) throw new Error(`Violações de CSP: ${csp.join(' | ')}`);
  if (errors.length) console.warn('  ! erros de console:', errors.slice(0, 5));
  log(`capturas em ${OUT}`);
} catch (err) {
  failed = true;
  console.error('FALHOU:', err.message);
} finally {
  await browser.close();
  server?.kill();
}
process.exit(failed ? 1 : 0);
