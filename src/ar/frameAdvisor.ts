// Analisa quadros da câmera localmente (miniatura 96×72, ~1,5 vez por segundo) para dizer
// à pessoa o que está atrapalhando o reconhecimento. Nenhum quadro é guardado ou enviado.

export type CameraHint = 'dark' | 'glare' | 'shaky' | 'blurry' | 'frame-it' | 'not-registered' | null;

export interface FrameMetrics {
  luminance: number;
  blown: number; // fração de pixels estourados
  motion: number; // diferença média para o quadro anterior (0–255)
  sharpness: number; // variância do Laplaciano
}

const W = 96;
const H = 72;

export function measureFrame(gray: Float32Array, prev: Float32Array | null): FrameMetrics {
  let sum = 0;
  let blown = 0;
  let motion = 0;
  for (let i = 0; i < gray.length; i++) {
    sum += gray[i];
    if (gray[i] > 245) blown++;
    if (prev) motion += Math.abs(gray[i] - prev[i]);
  }
  let lap = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const L = gray[i - 1] + gray[i + 1] + gray[i - W] + gray[i + W] - 4 * gray[i];
      lap += L;
      lapSq += L * L;
      n++;
    }
  }
  return {
    luminance: sum / gray.length,
    blown: blown / gray.length,
    motion: prev ? motion / gray.length : 0,
    sharpness: lapSq / n - (lap / n) ** 2,
  };
}

/** Decide a dica mais útil a partir de métricas suavizadas e do tempo procurando. */
export function decideHint(m: FrameMetrics, searchingSeconds: number): CameraHint {
  if (m.luminance < 50) return 'dark';
  if (m.blown > 0.06) return 'glare';
  if (m.motion > 22) return 'shaky';
  if (m.sharpness < 25 && searchingSeconds > 2) return 'blurry';
  if (searchingSeconds > 12) return 'not-registered';
  if (searchingSeconds > 4) return 'frame-it';
  return null;
}

export class FrameAdvisor {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private prev: Float32Array | null = null;
  private smooth: FrameMetrics | null = null;
  private timer = 0;
  private searchingSince = 0;
  private active = false;
  private last: CameraHint = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onHint: (hint: CameraHint) => void,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  /** Liga durante "procurando"/"perdida"; desliga quando a obra está sendo rastreada. */
  setSearching(searching: boolean): void {
    if (searching === this.active) return;
    this.active = searching;
    if (searching) {
      this.searchingSince = performance.now();
      this.prev = null;
      this.smooth = null;
      this.timer = window.setInterval(() => this.tick(), 650);
    } else {
      clearInterval(this.timer);
      this.emit(null);
    }
  }

  stop(): void {
    this.setSearching(false);
  }

  private tick(): void {
    if (this.video.readyState < 2 || document.hidden) return;
    this.ctx.drawImage(this.video, 0, 0, W, H);
    const { data } = this.ctx.getImageData(0, 0, W, H);
    const gray = new Float32Array(W * H);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    const m = measureFrame(gray, this.prev);
    this.prev = gray;
    const a = 0.5;
    this.smooth = this.smooth
      ? {
          luminance: this.smooth.luminance * (1 - a) + m.luminance * a,
          blown: this.smooth.blown * (1 - a) + m.blown * a,
          motion: this.smooth.motion * (1 - a) + m.motion * a,
          sharpness: this.smooth.sharpness * (1 - a) + m.sharpness * a,
        }
      : m;
    this.emit(decideHint(this.smooth, (performance.now() - this.searchingSince) / 1000));
  }

  private emit(h: CameraHint): void {
    if (h === this.last) return;
    this.last = h;
    this.onHint(h);
  }
}
