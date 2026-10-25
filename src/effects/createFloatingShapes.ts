import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  TorusGeometry,
  type Object3D,
} from 'three';

// Os três efeitos da Entrega 1 (plano, fase 6): forma flutuante, anel em rotação e
// partículas discretas. Coordenadas no espaço da âncora: largura do alvo = 1, origem no
// centro da imagem, +Z saindo da superfície em direção ao observador.

export interface Effect {
  readonly object: Object3D;
  /** dt em segundos; t = tempo acumulado em segundos. Sem alocações por quadro. */
  update(dt: number, t: number): void;
  dispose(): void;
}

export interface EffectsOptions {
  /** Altura do alvo em unidades da âncora (altura/largura da imagem). */
  aspect: number;
  reducedMotion: boolean;
}

const TURQUOISE = new Color('#2bb3a8');
const WARM = new Color('#e4572e');

function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Partial<Mesh>;
    m.geometry?.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

function createFloatingShape(speed: number): Effect {
  const group = new Group();
  const solid = new Mesh(
    new IcosahedronGeometry(0.16, 0),
    new MeshStandardMaterial({ color: TURQUOISE, flatShading: true, roughness: 0.35, metalness: 0.1 }),
  );
  const wire = new LineSegments(
    new EdgesGeometry(new IcosahedronGeometry(0.2, 0)),
    new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
  );
  group.add(solid, wire);
  group.position.set(0.08, 0.12, 0.32);
  const baseZ = group.position.z;

  return {
    object: group,
    update(_dt, t) {
      const s = t * speed;
      group.position.z = baseZ + Math.sin(s * 1.6) * 0.04;
      solid.rotation.set(s * 0.5, s * 0.8, 0);
      wire.rotation.set(-s * 0.3, s * 0.4, s * 0.2);
    },
    dispose: () => disposeObject(group),
  };
}

function createRotatingRing(speed: number): Effect {
  const group = new Group();
  const ring = new Mesh(
    new TorusGeometry(0.3, 0.014, 12, 96),
    new MeshStandardMaterial({ color: WARM, emissive: WARM, emissiveIntensity: 0.35, roughness: 0.4 }),
  );
  const inner = new Mesh(
    new TorusGeometry(0.24, 0.006, 8, 72),
    new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2 }),
  );
  group.add(ring, inner);
  group.position.set(0.08, 0.12, 0.32);

  return {
    object: group,
    update(dt) {
      ring.rotation.x += dt * speed * 0.9;
      ring.rotation.y += dt * speed * 0.35;
      inner.rotation.y -= dt * speed * 1.2;
      inner.rotation.z += dt * speed * 0.25;
    },
    dispose: () => disposeObject(group),
  };
}

function createParticles(count: number, aspect: number, speed: number): Effect {
  // Partículas sobem lentamente da superfície da obra e reciclam ao atingir o topo.
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count);
  const halfW = 0.5;
  const halfH = aspect / 2;
  const maxZ = 0.6;
  const reset = (i: number, randomZ: boolean) => {
    positions[i * 3] = (Math.random() * 2 - 1) * halfW;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * halfH;
    positions[i * 3 + 2] = randomZ ? Math.random() * maxZ : 0;
    velocities[i] = 0.03 + Math.random() * 0.08;
  };
  for (let i = 0; i < count; i++) reset(i, true);

  const geometry = new BufferGeometry();
  const attr = new BufferAttribute(positions, 3);
  geometry.setAttribute('position', attr);
  const material = new PointsMaterial({
    color: 0xbff7f0,
    size: 0.012,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);

  return {
    object: points,
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const iz = i * 3 + 2;
        positions[iz] += velocities[i] * dt * speed;
        positions[i * 3] += Math.sin(t * 0.7 + i) * 0.0006 * speed;
        if (positions[iz] > maxZ) reset(i, false);
      }
      attr.needsUpdate = true;
      material.opacity = 0.55 + Math.sin(t * 1.3) * 0.2;
    },
    dispose: () => disposeObject(points),
  };
}

/** Contorno do alvo para avaliar alinhamento/jitter em QA (ativado com ?debug=1). */
function createRegistrationFrame(aspect: number): Effect {
  const h = aspect / 2;
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-0.5, -h, 0, 0.5, -h, 0, 0.5, -h, 0, 0.5, h, 0, 0.5, h, 0, -0.5, h, 0, -0.5, h, 0, -0.5, -h, 0]), 3),
  );
  const lines = new LineSegments(g, new LineBasicMaterial({ color: 0x2bb3a8 }));
  return { object: lines, update() {}, dispose: () => disposeObject(lines) };
}

export interface EffectsBundle {
  readonly root: Group;
  update(dt: number): void;
  /** Reinicia a animação de entrada (chamar no targetFound). */
  playIntro(): void;
  dispose(): void;
}

export function createFloatingShapes({ aspect, reducedMotion }: EffectsOptions, debug = false): EffectsBundle {
  const speed = reducedMotion ? 0.3 : 1;
  const effects: Effect[] = [
    createFloatingShape(speed),
    createRotatingRing(speed),
    createParticles(reducedMotion ? 60 : 220, aspect, speed),
  ];
  if (debug) effects.push(createRegistrationFrame(aspect));

  const root = new Group();
  root.name = 'effects';
  effects.forEach((e) => root.add(e.object));

  let t = 0;
  let intro = 1;
  const INTRO_SECONDS = reducedMotion ? 0.01 : 0.45;

  return {
    root,
    update(dt) {
      // Limita dt para não "saltar" a animação após pausa (aba oculta, perda de alvo).
      const step = Math.min(dt, 0.1);
      t += step;
      if (intro < 1) {
        intro = Math.min(1, intro + step / INTRO_SECONDS);
        const e = 1 - Math.pow(1 - intro, 3);
        root.scale.setScalar(Math.max(0.001, e));
      }
      for (let i = 0; i < effects.length; i++) effects[i].update(step, t);
    },
    playIntro() {
      intro = 0;
      root.scale.setScalar(0.001);
    },
    dispose() {
      effects.forEach((e) => e.dispose());
      root.clear();
    },
  };
}
