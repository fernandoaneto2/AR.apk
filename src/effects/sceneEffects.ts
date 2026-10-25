import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type BufferGeometry as Geo,
  type Object3D,
} from 'three';
import type { OrbitShape, ParticleShape, SceneConfig } from '../scene/types';

// Efeitos gerados a partir da própria obra. Espaço da âncora: largura da obra = 1, origem no
// centro, +Y para cima, +Z saindo da superfície em direção a quem olha.

export interface EffectsInput {
  scene: SceneConfig;
  /** altura / largura da obra */
  aspect: number;
  /** Imagem da obra (para as camadas). Sem ela, o efeito de camadas é omitido. */
  image: HTMLImageElement | HTMLCanvasElement | null;
  /** Pontos de detalhe normalizados (origem no topo esquerdo), para nascer partículas. */
  featurePoints: ReadonlyArray<{ x: number; y: number }>;
  reducedMotion: boolean;
  debug?: boolean;
}

export interface EffectsBundle {
  readonly root: Group;
  update(dt: number): void;
  playIntro(): void;
  dispose(): void;
}

interface Effect {
  object: Object3D;
  /** p = progresso da entrada (0→1, com easing), t = tempo, dt = delta (s). */
  update(dt: number, t: number, p: number): void;
}

const toAnchor = (nx: number, ny: number, aspect: number) => ({ x: nx - 0.5, y: (0.5 - ny) * aspect });
const lightness = (hex: string) => {
  const c = new Color(hex);
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
};

function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Partial<Mesh>;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

// ---------- Camadas: a pintura se separa por grupos de cor e salta da superfície ----------
function createLayers(input: EffectsInput, intensity: number): Effect | null {
  const { image, aspect, scene } = input;
  if (!image) return null;
  const palette = scene.palette.slice(0, 5).map((h) => new Color(h));
  if (palette.length < 2) return null;

  const side = 640;
  const iw = (image as HTMLImageElement).naturalWidth || image.width;
  const ih = (image as HTMLImageElement).naturalHeight || image.height;
  const s = side / Math.max(iw, ih);
  const w = Math.max(1, Math.round(iw * s));
  const h = Math.max(1, Math.round(ih * s));
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(image, 0, 0, w, h);
  const data = sctx.getImageData(0, 0, w, h).data;
  // Classificação sobre uma cópia desfocada: regiões contínuas em vez de pixels soltos.
  sctx.filter = 'blur(3px)';
  sctx.drawImage(image, 0, 0, w, h);
  sctx.filter = 'none';
  const soft = sctx.getImageData(0, 0, w, h).data;

  // Atribui cada pixel à cor da paleta mais próxima.
  const pr = palette.map((c) => [c.r * 255, c.g * 255, c.b * 255]);
  let label = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = soft[i * 4];
    const g = soft[i * 4 + 1];
    const b = soft[i * 4 + 2];
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < pr.length; k++) {
      const d = (r - pr[k][0]) ** 2 + (g - pr[k][1]) ** 2 + (b - pr[k][2]) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    label[i] = best;
  }
  // Filtro de maioria 5×5 (duas passadas) para limpar bordas serrilhadas.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(w * h);
    const votes = new Uint16Array(palette.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        votes.fill(0);
        for (let dy = -2; dy <= 2; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -2; dx <= 2; dx++) votes[label[yy * w + Math.min(w - 1, Math.max(0, x + dx))]]++;
        }
        let best = 0;
        for (let k = 1; k < votes.length; k++) if (votes[k] > votes[best]) best = k;
        next[y * w + x] = best;
      }
    }
    label = next;
  }
  const counts = new Array(palette.length).fill(0);
  for (let i = 0; i < w * h; i++) counts[label[i]]++;
  // O grupo mais presente é o "fundo": fica na obra real. Os demais saltam, claros à frente.
  const bg = counts.indexOf(Math.max(...counts));
  const order = palette
    .map((_, k) => k)
    .filter((k) => k !== bg && counts[k] > w * h * 0.01)
    .sort((a, b) => lightness(scene.palette[a]) - lightness(scene.palette[b]));
  if (order.length === 0) return null;

  const group = new Group();
  const geo = new PlaneGeometry(1, aspect);
  const layers: Array<{ mesh: Mesh; shadow: Mesh; target: number; phase: number }> = [];
  const maxZ = 0.03 + 0.1 * intensity;
  order.forEach((k, idx) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      if (label[i] !== k) continue;
      out.data[i * 4] = data[i * 4];
      out.data[i * 4 + 1] = data[i * 4 + 1];
      out.data[i * 4 + 2] = data[i * 4 + 2];
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(geo, new MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, depthWrite: false }));
    // Sombra suave da camada sobre a obra: dá leitura de profundidade.
    const shadow = new Mesh(geo, new MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.28, alphaTest: 0.5, depthWrite: false }));
    shadow.position.z = 0.001;
    mesh.renderOrder = 10 + idx;
    shadow.renderOrder = 1;
    group.add(shadow, mesh);
    layers.push({ mesh, shadow, target: (maxZ * (idx + 1)) / order.length, phase: idx * 1.3 });
  });

  return {
    object: group,
    update(_dt, t, p) {
      for (const l of layers) {
        const z = l.target * p * (1 + 0.12 * Math.sin(t * 0.9 + l.phase));
        l.mesh.position.z = z + 0.002;
        // A sombra se desloca e esmaece conforme a camada sobe.
        l.shadow.position.set(z * 0.25, -z * 0.35, 0.001);
        (l.shadow.material as MeshBasicMaterial).opacity = 0.28 * p;
      }
    },
  };
}

// ---------- Partículas nas cores da obra, nascendo dos detalhes ----------
function spriteTexture(shape: ParticleShape): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.translate(32, 32);
  if (shape === 'circle') {
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, 30, 0, Math.PI * 2);
    g.fill();
  } else if (shape === 'petal') {
    g.rotate(Math.PI / 5);
    g.beginPath();
    g.ellipse(0, 0, 26, 12, 0, 0, Math.PI * 2);
    g.fill();
  } else if (shape === 'spark') {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? 30 : 8;
      const a = (i / 8) * Math.PI * 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  } else {
    g.fillRect(-18, -18, 36, 36);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function createParticles(input: EffectsInput, intensity: number): Effect {
  const { scene, aspect, featurePoints, reducedMotion } = input;
  const cfg = scene.effects.particles;
  const count = Math.round((60 + cfg.density * 300) * (reducedMotion ? 0.3 : 1));
  const speed = (0.4 + scene.energy * 0.9) * (reducedMotion ? 0.3 : 1);
  const halfH = aspect / 2;
  const focus = toAnchor(scene.focus.x, scene.focus.y, aspect);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const age = new Float32Array(count);
  const colors = scene.palette.map((h) => new Color(h));

  const spawn = (i: number, initial: boolean) => {
    let x: number;
    let y: number;
    if (featurePoints.length > 0) {
      const fp = featurePoints[(Math.random() * featurePoints.length) | 0];
      ({ x, y } = toAnchor(fp.x, fp.y, aspect));
    } else {
      x = Math.random() - 0.5;
      y = (Math.random() * 2 - 1) * halfH;
    }
    let z = 0.005;
    const m = cfg.motion;
    if (m === 'fall') {
      z = 0.25 + Math.random() * 0.25;
      vel[i * 3] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 1] = -0.02 - Math.random() * 0.03;
      vel[i * 3 + 2] = -0.05 - Math.random() * 0.05;
    } else if (m === 'drift') {
      z = 0.01 + Math.random() * 0.08;
      vel[i * 3] = (Math.random() - 0.5) * 0.05;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
      vel[i * 3 + 2] = (Math.random() - 0.3) * 0.02;
    } else {
      vel[i * 3] = (Math.random() - 0.5) * 0.03;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
      vel[i * 3 + 2] = 0.04 + Math.random() * 0.08;
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = initial ? z + Math.random() * 0.2 : z;
    age[i] = initial ? Math.random() * 4 : 0;
    const c = colors[(Math.random() * colors.length) | 0];
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  };
  for (let i = 0; i < count; i++) spawn(i, true);

  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', new BufferAttribute(col, 3));
  const mat = new PointsMaterial({
    size: 0.018 + 0.02 * intensity,
    map: spriteTexture(cfg.shape),
    vertexColors: true,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: false,
    opacity: 0,
  });
  const points = new Points(geo, mat);
  points.renderOrder = 30;

  return {
    object: points,
    update(dt, t, p) {
      mat.opacity = 0.95 * p;
      const step = dt * speed;
      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        age[i] += dt;
        if (cfg.motion === 'swirl') {
          // Redemoinho em torno do ponto de interesse, subindo.
          const dx = pos[ix] - focus.x;
          const dy = pos[ix + 1] - focus.y;
          const r = Math.hypot(dx, dy) + 1e-4;
          pos[ix] += (-dy / r) * 0.12 * step + dx * 0.05 * step;
          pos[ix + 1] += (dx / r) * 0.12 * step + dy * 0.05 * step;
          pos[ix + 2] += 0.05 * step;
        } else {
          pos[ix] += vel[ix] * step + Math.sin(t * 0.8 + i) * 0.0004;
          pos[ix + 1] += vel[ix + 1] * step;
          pos[ix + 2] += vel[ix + 2] * step;
        }
        const out = pos[ix + 2] > 0.6 || pos[ix + 2] < 0 || Math.abs(pos[ix]) > 0.75 || Math.abs(pos[ix + 1]) > halfH + 0.25 || age[i] > 9;
        if (out) spawn(i, false);
      }
      posAttr.needsUpdate = true;
    },
  };
}

// ---------- Aura: contorno luminoso e varredura ao reconhecer ----------
function createAura(input: EffectsInput): Effect {
  const { aspect, scene } = input;
  const accent = new Color(scene.palette.find((h) => lightness(h) > 0.45) ?? '#2bb3a8');
  const group = new Group();
  const t = 0.012;
  const mat = new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const h = aspect;
  const edges: Array<[number, number, number, number]> = [
    [0, h / 2 + t / 2, 1 + 2 * t, t],
    [0, -h / 2 - t / 2, 1 + 2 * t, t],
    [-0.5 - t / 2, 0, t, h],
    [0.5 + t / 2, 0, t, h],
  ];
  for (const [x, y, w, hh] of edges) {
    const m = new Mesh(new PlaneGeometry(w, hh), mat);
    m.position.set(x, y, 0.003);
    group.add(m);
  }
  // Faixa de varredura com degradê vertical.
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 64);
  const sweepMat = new MeshBasicMaterial({ map: new CanvasTexture(c), color: accent, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
  const sweep = new Mesh(new PlaneGeometry(1, 0.18 * aspect), sweepMat);
  sweep.position.z = 0.004;
  group.add(sweep);

  let sweepT = 0;
  return {
    object: group,
    update(dt, time, p) {
      mat.opacity = (0.35 + 0.25 * Math.sin(time * 2.2)) * p;
      if (p < 1) sweepT = 0;
      sweepT += dt;
      const k = Math.min(1, sweepT / 1.4);
      sweep.position.y = h / 2 - k * h;
      sweepMat.opacity = k < 1 ? 0.7 * Math.sin(k * Math.PI) : 0;
    },
  };
}

// ---------- Objeto 3D sobre o ponto de interesse ----------
function orbitGeometry(shape: OrbitShape): Geo {
  if (shape === 'torus') return new TorusGeometry(0.07, 0.022, 16, 64);
  if (shape === 'sphere') return new SphereGeometry(0.075, 32, 16);
  if (shape === 'cube') return new BoxGeometry(0.11, 0.11, 0.11);
  return new IcosahedronGeometry(0.085, 0);
}

function createOrbit(input: EffectsInput): Effect {
  const { scene, aspect } = input;
  const f = toAnchor(scene.focus.x, scene.focus.y, aspect);
  const c1 = new Color(scene.palette[0]);
  const c2 = new Color(scene.palette[1] ?? scene.palette[0]);
  const group = new Group();
  const solid = new Mesh(orbitGeometry(scene.effects.orbit.shape), new MeshStandardMaterial({ color: c1, flatShading: true, roughness: 0.35, metalness: 0.15 }));
  const wire = new LineSegments(new EdgesGeometry(new IcosahedronGeometry(0.11, 0)), new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  const ring = new Mesh(new TorusGeometry(0.15, 0.006, 8, 96), new MeshStandardMaterial({ color: c2, emissive: c2, emissiveIntensity: 0.4 }));
  group.add(solid, wire, ring);
  const speed = 0.4 + scene.energy;
  return {
    object: group,
    update(_dt, t, p) {
      group.position.set(f.x, f.y, (0.18 + Math.sin(t * 1.4) * 0.02) * p);
      group.scale.setScalar(Math.max(0.001, p));
      solid.rotation.set(t * 0.5 * speed, t * 0.8 * speed, 0);
      wire.rotation.set(-t * 0.3 * speed, t * 0.4 * speed, 0);
      ring.rotation.set(t * 0.9 * speed, t * 0.35 * speed, 0);
    },
  };
}

function createRegistrationFrame(aspect: number): Effect {
  const h = aspect / 2;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -h, 0, 0.5, -h, 0, 0.5, -h, 0, 0.5, h, 0, 0.5, h, 0, -0.5, h, 0, -0.5, h, 0, -0.5, -h, 0]), 3));
  return { object: new LineSegments(g, new LineBasicMaterial({ color: 0x00ffcc })), update() {} };
}

export function createSceneEffects(input: EffectsInput): EffectsBundle {
  const { scene, reducedMotion } = input;
  const intensity = reducedMotion ? 0.3 : 1;
  const effects: Effect[] = [];
  const e = scene.effects;
  if (e.layers.enabled) {
    const l = createLayers(input, e.layers.depth * intensity);
    if (l) effects.push(l);
  }
  if (e.aura.enabled) effects.push(createAura(input));
  if (e.particles.enabled) effects.push(createParticles(input, intensity));
  if (e.orbit.enabled) effects.push(createOrbit(input));
  if (input.debug) effects.push(createRegistrationFrame(input.aspect));

  const root = new Group();
  root.name = 'scene-effects';
  effects.forEach((x) => root.add(x.object));

  let t = 0;
  let intro = 1;
  const INTRO = reducedMotion ? 0.2 : 1.1;
  return {
    root,
    update(dt) {
      const step = Math.min(dt, 0.1);
      t += step;
      if (intro < 1) intro = Math.min(1, intro + step / INTRO);
      // easeOutBack: leve "salto" ao surgir.
      const c = 1.4;
      const x = intro - 1;
      const p = reducedMotion ? intro : 1 + (c + 1) * x ** 3 + c * x ** 2;
      for (const fx of effects) fx.update(step, t, Math.max(0, p));
    },
    playIntro() {
      intro = 0;
    },
    dispose() {
      disposeTree(root);
      root.clear();
    },
  };
}
