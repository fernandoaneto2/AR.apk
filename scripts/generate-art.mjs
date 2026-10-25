#!/usr/bin/env node
// Gera a arte-alvo original "Campo Expandido nº 1" de forma determinística (seed fixa).
// Saídas: public/images/obra-original.svg, .png (alta) e .jpg (usado na UI e no compilador).
//
// Requisitos de rastreabilidade (plano mestre, seção 02): composição abstrata, assimétrica,
// alto contraste, muitos cantos/detalhes distribuídos, sem grandes áreas lisas e sem repetição.
//
// Uso: npm run art            (seed padrão)
//      node scripts/generate-art.mjs --seed 7

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib/playwright.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/images');

const W = 1200;
const H = 1600;
const seedArg = process.argv.indexOf('--seed');
const SEED = seedArg > -1 ? Number(process.argv[seedArg + 1]) : 2026;

// PRNG mulberry32 — reprodutível entre máquinas.
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const r = (min, max) => min + rnd() * (max - min);
const ri = (min, max) => Math.floor(r(min, max + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const f = (n) => n.toFixed(1);

// Paleta: neutros de galeria + turquesa de acento + um quente para contraste de luminância.
const INK = '#111214';
const PAPER = '#f2efe8';
const PALETTE = ['#111214', '#1f6f6b', '#2bb3a8', '#e4572e', '#f2c14e', '#5b5f97', '#d9d4c7', '#3a3d42'];

const parts = [];
const push = (s) => parts.push(s);

// 1) Fundo com faixas diagonais de valores diferentes (evita áreas lisas extensas).
push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
for (let i = 0; i < 9; i++) {
  const x = r(-400, W);
  const w = r(60, 260);
  push(
    `<polygon points="${f(x)},0 ${f(x + w)},0 ${f(x + w - r(200, 500))},${H} ${f(x - r(200, 500))},${H}" fill="${pick(['#e3ded2', '#d6d0c2', '#ebe7de', '#cfc8b8'])}"/>`,
  );
}

// 2) Textura de pontilhado aleatório (pontos de interesse distribuídos).
for (let i = 0; i < 2600; i++) {
  push(`<circle cx="${f(r(0, W))}" cy="${f(r(0, H))}" r="${f(r(0.8, 3.2))}" fill="${pick([INK, '#3a3d42', '#7a7466'])}" opacity="${f(r(0.35, 0.9))}"/>`);
}

// 3) Grandes polígonos irregulares (massas assimétricas).
for (let i = 0; i < 14; i++) {
  const cx = r(0, W);
  const cy = r(0, H);
  const n = ri(3, 7);
  const rad = r(90, 300);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r(-0.4, 0.4);
    const rr = rad * r(0.45, 1.1);
    pts.push(`${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`);
  }
  push(`<polygon points="${pts.join(' ')}" fill="${pick(PALETTE)}" opacity="${f(r(0.75, 1))}"/>`);
}

// 4) Hachuras recortadas em retângulos rotacionados (alto contraste de borda).
let clipId = 0;
for (let i = 0; i < 10; i++) {
  const x = r(0, W - 150);
  const y = r(0, H - 150);
  const w = r(110, 320);
  const h = r(110, 320);
  const rot = r(-50, 50);
  const id = `c${clipId++}`;
  const gap = r(7, 16);
  const color = pick([INK, PAPER, '#1f6f6b']);
  let lines = '';
  for (let k = -h; k < w + h; k += gap) {
    lines += `<line x1="${f(x + k)}" y1="${f(y)}" x2="${f(x + k - h)}" y2="${f(y + h)}" stroke="${color}" stroke-width="${f(gap * r(0.25, 0.5))}"/>`;
  }
  push(
    `<clipPath id="${id}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" transform="rotate(${f(rot)} ${f(x + w / 2)} ${f(y + h / 2)})"/></clipPath><g clip-path="url(#${id})">${lines}</g>`,
  );
}

// 5) Círculos e anéis de tamanhos variados.
for (let i = 0; i < 22; i++) {
  const cx = r(0, W);
  const cy = r(0, H);
  const rad = r(14, 140);
  if (rnd() < 0.5) {
    push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="${pick(PALETTE)}"/>`);
  } else {
    push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="none" stroke="${pick([INK, '#2bb3a8', '#e4572e', PAPER])}" stroke-width="${f(r(4, 18))}"/>`);
  }
}

// 6) Traços quebrados (polilinhas) — muitos cantos detectáveis.
for (let i = 0; i < 26; i++) {
  let x = r(0, W);
  let y = r(0, H);
  const pts = [`${f(x)},${f(y)}`];
  for (let k = 0; k < ri(3, 8); k++) {
    x += r(-180, 180);
    y += r(-180, 180);
    pts.push(`${f(x)},${f(y)}`);
  }
  push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${pick([INK, PAPER, '#2bb3a8', '#f2c14e'])}" stroke-width="${f(r(2, 12))}" stroke-linejoin="miter" stroke-linecap="square"/>`);
}

// 7) Pequenos glifos geométricos (quadrados, cruzes, triângulos) espalhados.
for (let i = 0; i < 160; i++) {
  const x = r(0, W);
  const y = r(0, H);
  const s = r(6, 34);
  const c = pick(PALETTE.concat([PAPER, PAPER]));
  const t = ri(0, 2);
  const rot = f(r(0, 90));
  if (t === 0) push(`<rect x="${f(x)}" y="${f(y)}" width="${f(s)}" height="${f(s)}" fill="${c}" transform="rotate(${rot} ${f(x)} ${f(y)})"/>`);
  else if (t === 1) push(`<path d="M${f(x - s)} ${f(y)}H${f(x + s)}M${f(x)} ${f(y - s)}V${f(y + s)}" stroke="${c}" stroke-width="${f(s / 4)}" transform="rotate(${rot} ${f(x)} ${f(y)})"/>`);
  else push(`<polygon points="${f(x)},${f(y - s)} ${f(x + s)},${f(y + s)} ${f(x - s)},${f(y + s)}" fill="${c}" transform="rotate(${rot} ${f(x)} ${f(y)})"/>`);
}

// 8) Moldura fina assimétrica (ajuda a delimitar o alvo impresso).
push(`<rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="${INK}" stroke-width="10"/>`);
push(`<rect x="0" y="${H - 120}" width="140" height="120" fill="${INK}"/>`);
push(`<text x="28" y="${H - 50}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="34" fill="${PAPER}">CE·01</text>`);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- "Campo Expandido nº 1" — arte original gerada por scripts/generate-art.mjs (seed ${SEED}). Licença: CC BY 4.0, ver ART_LICENSE.md -->
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${parts.join('\n')}
</svg>
`;

await mkdir(OUT_DIR, { recursive: true });
const svgPath = resolve(OUT_DIR, 'obra-original.svg');
await writeFile(svgPath, svg);
console.log(`SVG: ${svgPath} (${(svg.length / 1024).toFixed(0)} KB, seed ${SEED})`);

// Rasterização via Chromium (Playwright) — mesmo motor que renderiza SVG nos navegadores.
let chromium;
try {
  ({ chromium } = await loadPlaywright());
} catch {
  console.warn('Playwright não encontrado: apenas o SVG foi gerado. Instale com `npm i -D playwright` para exportar PNG/JPG.');
  process.exit(0);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0">${svg.replace(/^<\?xml[^>]*>/, '')}</body></html>`);
const pngPath = resolve(OUT_DIR, 'obra-original.png');
const jpgPath = resolve(OUT_DIR, 'obra-original.jpg');
await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: W, height: H } });
await page.screenshot({ path: jpgPath, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();
console.log(`PNG: ${pngPath}\nJPG: ${jpgPath}`);
