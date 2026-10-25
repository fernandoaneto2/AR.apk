#!/usr/bin/env node
// Compila uma imagem em um alvo MindAR (.mind) usando o compilador oficial do próprio
// pacote mind-ar (mesma versão usada em runtime), executado em Chromium headless.
//
// Uso: npm run target
//      node scripts/compile-target.mjs --image public/images/obra-original.jpg --out public/targets/obra-original.mind
//
// Alternativa manual: https://hiukim.github.io/mind-ar-js-doc/tools/compile (ver scripts/compile-target.md).

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib/playwright.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const imagePath = resolve(ROOT, arg('--image', 'public/images/obra-original.jpg'));
const outPath = resolve(ROOT, arg('--out', 'public/targets/obra-original.mind'));

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

const PAGE = `<!doctype html><html><body><script type="module">
import { Compiler } from '/node_modules/mind-ar/dist/mindar-image.prod.js';
window.compile = async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const compiler = new Compiler();
  let last = -10;
  await compiler.compileImageTargets([img], (p) => { if (p - last >= 10) { last = p; console.log('progresso ' + p.toFixed(0) + '%'); } });
  const buf = compiler.exportData();
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { base64: btoa(bin), width: img.width, height: img.height };
};
window.ready = true;
</script></body></html>`;

// Servidor estático mínimo restrito à raiz do projeto.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    return;
  }
  const file = resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`  [browser] ${m.text()}`));
  page.on('pageerror', (e) => console.error(`  [browser error] ${e.message}`));
  await page.goto(base + '/');
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 });

  const rel = '/' + relative(ROOT, imagePath).split(sep).join('/');
  console.log(`Compilando ${rel} ...`);
  const t0 = Date.now();
  const result = await page.evaluate((src) => window.compile(src), rel);
  const bytes = Buffer.from(result.base64, 'base64');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, bytes);
  console.log(
    `OK: ${relative(ROOT, outPath)} (${(bytes.length / 1024).toFixed(0)} KB, imagem ${result.width}x${result.height}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
} finally {
  await browser.close();
  server.close();
}
