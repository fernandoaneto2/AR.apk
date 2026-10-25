// Ferramentas de imagem 100% locais: carregar, corrigir perspectiva, redimensionar, codificar.

export interface Point {
  x: number;
  y: number;
}
/** Cantos em ordem: superior-esquerdo, superior-direito, inferior-direito, inferior-esquerdo. */
export type Quad = [Point, Point, Point, Point];

/** Lado maior da imagem-alvo. 1024 px equilibra detalhe (rastreamento) e tempo de compilação no celular. */
export const TARGET_MAX_SIDE = 1024;

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // A imagem decodificada continua utilizável após revogar a URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Imagem rasterizada num canvas com o lado maior limitado (respeita orientação EXIF via <img>). */
export function toCanvas(img: CanvasImageSource & { width: number; height: number }, maxSide: number): HTMLCanvasElement {
  const w = (img as HTMLImageElement).naturalWidth || img.width;
  const h = (img as HTMLImageElement).naturalHeight || img.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Resolve A·h = b (8×8) por eliminação de Gauss com pivoteamento parcial. */
function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Homografia que leva pontos de `from` para `to` (3×3 em linha, h33 = 1). */
export function homography(from: Quad, to: Quad): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve8(A, b), 1];
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Recorta e "desentorta" a obra a partir de 4 cantos marcados sobre `src`.
 * O tamanho de saída segue as proporções medidas do quadrilátero, limitado a `maxSide`.
 */
export function warpQuad(src: HTMLCanvasElement, quad: Quad, maxSide = TARGET_MAX_SIDE): HTMLCanvasElement {
  const wTop = dist(quad[0], quad[1]);
  const wBot = dist(quad[3], quad[2]);
  const hL = dist(quad[0], quad[3]);
  const hR = dist(quad[1], quad[2]);
  let W = Math.max(wTop, wBot);
  let H = Math.max(hL, hR);
  const s = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(16, Math.round(W * s));
  H = Math.max(16, Math.round(H * s));

  const rect: Quad = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ];
  // Mapeamento inverso: para cada pixel de destino, onde amostrar na origem.
  const m = homography(rect, quad);
  const sw = src.width;
  const sh = src.height;
  const sData = src.getContext('2d')!.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d')!;
  const dst = octx.createImageData(W, H);
  const d = dst.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const z = m[6] * x + m[7] * y + m[8];
      const sx = (m[0] * x + m[1] * y + m[2]) / z;
      const sy = (m[3] * x + m[4] * y + m[5]) / z;
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(sy)));
      const fx = Math.min(1, Math.max(0, sx - x0));
      const fy = Math.min(1, Math.max(0, sy - y0));
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = sData[i00 + k] * (1 - fx) + sData[i10 + k] * fx;
        const bot = sData[i01 + k] * (1 - fx) + sData[i11 + k] * fx;
        d[o + k] = top * (1 - fy) + bot * fy;
      }
      d[o + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob falhou'))), type, quality));
}

/** Base64 (sem prefixo data:) de um JPEG reduzido, para enviar à IA. */
export async function jpegBase64(c: HTMLCanvasElement, maxSide = 768, quality = 0.82): Promise<string> {
  const small = toCanvas(c, maxSide);
  const blob = await canvasToBlob(small, 'image/jpeg', quality);
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Detecção automática da obra numa foto: separa o que difere das cores da borda (parede,
 * mesa), pega a maior região conectada e estima os 4 cantos pelos extremos diagonais.
 * Retorna null quando não encontra um candidato plausível (o usuário ajusta à mão).
 */
export function detectArtworkQuad(src: HTMLCanvasElement): Quad | null {
  const S = 160;
  const small = toCanvas(src, S);
  const w = small.width;
  const h = small.height;
  const { data } = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h);
  const rgb = (i: number) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];

  // Amostras da borda (2 px) → 3 cores de fundo por k-means.
  const border: number[][] = [];
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) border.push(rgb(y * w + x));
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) border.push(rgb(y * w + x));
  let centers = [border[0], border[Math.floor(border.length / 2)], border[border.length - 1]].map((c) => [...c]);
  for (let it = 0; it < 8; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of border) {
      let best = 0;
      let bd = Infinity;
      centers.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      sums[best][3]++;
    }
    centers = centers.map((c, j) => (sums[j][3] ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : c));
  }

  // Máscara de "primeiro plano": longe de todas as cores de fundo.
  const T2 = 42 ** 2;
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = rgb(i);
    mask[i] = centers.every((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 > T2) ? 1 : 0;
  }
  // Fechamento morfológico 3×3 (dilata e erode) para unir a obra em uma só região.
  const morph = (m: Uint8Array, dilate: boolean) => {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            const s = m[yy * w + xx];
            v = dilate ? v | s : v & s;
          }
        o[y * w + x] = v;
      }
    return o;
  };
  // Abertura (remove linhas finas como a junção parede/mesa) e depois fechamento (une a obra).
  mask = morph(morph(morph(morph(mask, false), false), true), true);
  mask = morph(morph(mask, true), false);

  // Maior componente conectado (4-vizinhança).
  const seen = new Uint8Array(w * h);
  let bestPix: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    const comp: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      comp.push(j);
      const x = j % w;
      const y = (j / w) | 0;
      const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1];
      for (const n of nb) if (n >= 0 && mask[n] && !seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (comp.length > bestPix.length) bestPix = comp;
  }
  const area = bestPix.length / (w * h);
  if (area < 0.12 || area > 0.97) return null;

  // Cantos: extremos de x+y e x−y.
  let tl = bestPix[0], tr = tl, br = tl, bl = tl;
  const sx = (j: number) => j % w;
  const sy = (j: number) => (j / w) | 0;
  for (const j of bestPix) {
    const x = sx(j);
    const y = sy(j);
    if (x + y < sx(tl) + sy(tl)) tl = j;
    if (x + y > sx(br) + sy(br)) br = j;
    if (x - y > sx(tr) - sy(tr)) tr = j;
    if (x - y < sx(bl) - sy(bl)) bl = j;
  }
  const k = src.width / w;
  const pt = (j: number): Point => ({ x: (sx(j) + 0.5) * k, y: (sy(j) + 0.5) * k });
  const quad: Quad = [pt(tl), pt(tr), pt(br), pt(bl)];
  // Rejeita quadriláteros degenerados ou que não são "cheios" pela região (sinal de detecção errada).
  const minSide = Math.min(dist(quad[0], quad[1]), dist(quad[1], quad[2]), dist(quad[2], quad[3]), dist(quad[3], quad[0]));
  if (minSide < src.width * 0.08) return null;
  const quadArea = (q: Quad) => Math.abs(q.reduce((acc, p, i) => acc + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2;
  const fill = (bestPix.length * k * k) / quadArea(quad);
  return fill > 0.85 && fill < 1.15 ? quad : null;
}
