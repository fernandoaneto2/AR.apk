import type { Point, Quad } from '../artworks/imageTools';

// Ajuste dos 4 cantos da obra sobre a foto (toque/arrasto, ou setas do teclado).

const LABELS = ['Canto superior esquerdo', 'Canto superior direito', 'Canto inferior direito', 'Canto inferior esquerdo'];

export class Cropper {
  private readonly wrap = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly shade = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  private readonly outline = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  private readonly handles: HTMLButtonElement[] = [];
  private src: HTMLCanvasElement | null = null;
  private quad: Quad = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  private scale = 1;
  private readonly ro: ResizeObserver;

  constructor(private readonly host: HTMLElement) {
    this.wrap.className = 'cropper';
    this.canvas.className = 'cropper-image';
    this.svg.classList.add('cropper-overlay');
    this.svg.setAttribute('aria-hidden', 'true');
    this.shade.setAttribute('fill-rule', 'evenodd');
    this.shade.setAttribute('class', 'cropper-shade');
    this.outline.setAttribute('class', 'cropper-outline');
    this.svg.append(this.shade, this.outline);
    this.wrap.append(this.canvas, this.svg);
    LABELS.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cropper-handle';
      b.setAttribute('aria-label', `${label} (use as setas para mover)`);
      b.addEventListener('pointerdown', (e) => this.drag(e, i));
      b.addEventListener('keydown', (e) => this.key(e, i));
      this.handles.push(b);
      this.wrap.append(b);
    });
    host.replaceChildren(this.wrap);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
  }

  setImage(src: HTMLCanvasElement, quad: Quad | null): void {
    this.src = src;
    this.canvas.width = src.width;
    this.canvas.height = src.height;
    this.canvas.getContext('2d')!.drawImage(src, 0, 0);
    this.quad = quad ?? Cropper.fullQuad(src, 0.06);
    this.layout();
  }

  setQuad(q: Quad): void {
    this.quad = q;
    this.render();
  }

  getQuad(): Quad {
    return this.quad.map((p) => ({ ...p })) as Quad;
  }

  static fullQuad(src: HTMLCanvasElement, inset = 0): Quad {
    const ix = src.width * inset;
    const iy = src.height * inset;
    return [
      { x: ix, y: iy },
      { x: src.width - ix, y: iy },
      { x: src.width - ix, y: src.height - iy },
      { x: ix, y: src.height - iy },
    ];
  }

  destroy(): void {
    this.ro.disconnect();
    this.wrap.remove();
  }

  private layout(): void {
    if (!this.src) return;
    const maxW = this.host.clientWidth;
    const maxH = Math.max(240, window.innerHeight * 0.58);
    this.scale = Math.min(maxW / this.src.width, maxH / this.src.height);
    const w = Math.round(this.src.width * this.scale);
    const h = Math.round(this.src.height * this.scale);
    this.wrap.style.width = `${w}px`;
    this.wrap.style.height = `${h}px`;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.render();
  }

  private render(): void {
    if (!this.src) return;
    const s = this.scale;
    const w = this.src.width * s;
    const h = this.src.height * s;
    const pts = this.quad.map((p) => `${(p.x * s).toFixed(1)},${(p.y * s).toFixed(1)}`);
    this.outline.setAttribute('points', pts.join(' '));
    this.shade.setAttribute('d', `M0 0H${w}V${h}H0Z M${pts.join(' L')}Z`);
    this.quad.forEach((p, i) => {
      this.handles[i].style.transform = `translate(${p.x * s}px, ${p.y * s}px)`;
    });
  }

  private clamp(p: Point): Point {
    const src = this.src!;
    return { x: Math.min(src.width, Math.max(0, p.x)), y: Math.min(src.height, Math.max(0, p.y)) };
  }

  private drag(e: PointerEvent, i: number): void {
    e.preventDefault();
    const handle = this.handles[i];
    handle.setPointerCapture(e.pointerId);
    const rect = this.wrap.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      this.quad[i] = this.clamp({ x: (ev.clientX - rect.left) / this.scale, y: (ev.clientY - rect.top) / this.scale });
      this.render();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  private key(e: KeyboardEvent, i: number): void {
    const d = (e.shiftKey ? 20 : 4) / this.scale;
    const delta: Record<string, Point> = { ArrowLeft: { x: -d, y: 0 }, ArrowRight: { x: d, y: 0 }, ArrowUp: { x: 0, y: -d }, ArrowDown: { x: 0, y: d } };
    const m = delta[e.key];
    if (!m) return;
    e.preventDefault();
    this.quad[i] = this.clamp({ x: this.quad[i].x + m.x, y: this.quad[i].y + m.y });
    this.render();
  }
}
