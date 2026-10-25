#!/usr/bin/env node
// Teste ponta a ponta do pipeline de rastreamento SEM aparelho físico:
// 1. gera com ffmpeg um vídeo .y4m em que a obra aparece (com leve movimento), some e reaparece;
// 2. sobe `vite preview` do build de produção;
// 3. abre o Chromium com esse vídeo como "câmera" falsa e clica em "Iniciar experiência";
// 4. verifica a sequência real de estados emitida pelo MindAR: scanning → found → lost → found.
//
// Isto valida integração (alvo .mind, câmera, worker, eventos, UI). NÃO substitui o QA em
// iPhone/Android reais (luz, foco, reflexo, desempenho) — ver tests/smoke-checklist.md.
//
// Pré-requisitos: `npm run build`, ffmpeg no PATH e Playwright com Chromium.

import { spawn, execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../../scripts/lib/playwright.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'tests/e2e/.artifacts');
const VIDEO = resolve(OUT, 'fake-camera.y4m');
const PORT = 4789;

await mkdir(OUT, { recursive: true });
if (!existsSync(resolve(ROOT, 'dist/index.html'))) throw new Error('Rode `npm run build` antes.');

// Linha do tempo do vídeo (s): 0–1.5 sem obra | 1.5–7 obra | 7–9.5 sem obra | 9.5–16 obra.
if (!existsSync(VIDEO) || process.argv.includes('--regen')) {
console.log('Gerando vídeo de câmera falsa…');
execFileSync(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x5f5d58:s=640x480:r=15:d=16',
    '-loop', '1', '-i', resolve(ROOT, 'public/images/obra-original.jpg'),
    '-filter_complex',
    "[0]noise=alls=18:allf=t[bg];[1]scale=-2:400,format=yuv420p[art];" +
      "[bg][art]overlay=x='(W-w)/2+24*sin(t*1.1)':y='(H-h)/2+10*sin(t*0.8)':enable='between(t,1.5,7)+between(t,9.5,16)':shortest=1,format=yuv420p",
    '-t', '16',
    VIDEO,
  ],
  { stdio: 'inherit' },
);
}

const server = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((ok, fail) => {
  const t = setTimeout(() => {
    server.kill();
    fail(new Error('vite preview não subiu'));
  }, 30_000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      ok();
    }
  });
});

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${VIDEO}`,
    '--ignore-gpu-blocklist',
  ],
});

let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.grantPermissions(['camera']);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  const cspViolations = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
    console.error('  [console.error]', m.text());
  });

  await page.goto(`http://127.0.0.1:${PORT}/?debug=1`);
  await page.screenshot({ path: resolve(OUT, '01-home.png') });
  const t0 = Date.now();
  await page.click('#btn-start');

  const kinds = () => page.evaluate(() => window.__webar.state.log.map((e) => e.kind));
  const waitFor = async (predicate, label, timeout) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const k = await kinds();
      if (predicate(k)) {
        console.log(`  ✓ ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${k.join(' → ')}`);
        return k;
      }
      if (k.includes('error')) {
        const s = await page.evaluate(() => window.__webar.state.state);
        throw new Error(`Estado de erro: ${JSON.stringify(s)}`);
      }
      await page.waitForTimeout(150);
    }
    throw new Error(`Timeout esperando: ${label}. Log: ${(await kinds()).join(' → ')}`);
  };

  await waitFor((k) => k.includes('scanning'), 'motor pronto, procurando a obra', 90_000);
  await page.screenshot({ path: resolve(OUT, '02-scanning.png') });
  await waitFor((k) => k.includes('found'), 'obra reconhecida (targetFound)', 60_000);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(OUT, '03-found.png') });
  await waitFor((k) => k.lastIndexOf('lost') > k.indexOf('found'), 'obra perdida (targetLost)', 40_000);
  await page.screenshot({ path: resolve(OUT, '04-lost.png') });
  await waitFor((k) => k.lastIndexOf('found') > k.indexOf('lost'), 'obra reencontrada', 40_000);

  // Saída: câmera precisa ser encerrada (sem tracks vivas).
  await page.click('#btn-close');
  const live = await page.evaluate(() => document.querySelectorAll('video').length);
  if (live !== 0) throw new Error(`Esperava nenhum <video> após sair; há ${live}.`);
  console.log('  ✓ saída: câmera e vídeo removidos');

  // Modo demonstração renderiza sem câmera.
  await page.click('#btn-demo');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, '05-demo.png') });
  console.log(`  ✓ modo demonstração. Capturas em ${OUT}`);
  if (cspViolations.length) throw new Error(`Violações de CSP: ${cspViolations.length}`);
  console.log('  ✓ nenhuma violação de CSP');
} catch (err) {
  failed = true;
  console.error('FALHOU:', err.message);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
