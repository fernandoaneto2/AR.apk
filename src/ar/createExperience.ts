import {
  Clock,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ExperienceError, openCamera, stopCamera, syncVideoSize } from './camera';
import type { EngineFactory, TrackingEngine } from './engine';
import { createMindAREngine } from './mindarEngine';
import type { TrackingStateMachine } from './trackingState';
import { createFloatingShapes, type EffectsBundle } from '../effects/createFloatingShapes';

export type DistanceHint = 'too-far' | 'too-close' | null;

export interface Experience {
  /** Desmonta tudo: câmera, loop, listeners, worker e recursos de GPU. Idempotente. */
  stop(): void;
}

interface CommonOptions {
  container: HTMLElement;
  reducedMotion: boolean;
  debug: boolean;
  onFps?: (fps: number) => void;
}

export interface ARExperienceOptions extends CommonOptions {
  targetUrl: string;
  state: TrackingStateMachine;
  onDistanceHint?: (hint: DistanceHint) => void;
  engineFactory?: EngineFactory;
}

const MAX_PIXEL_RATIO = 2;
// Faixa de tamanho aparente do alvo (fração do lado menor do quadro) considerada confortável.
const MIN_APPARENT = 0.3;
const MAX_APPARENT = 1.25;

function createRenderer(container: HTMLElement): WebGLRenderer {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    throw new ExperienceError('webgl', err);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.className = 'ar-canvas';
  container.appendChild(renderer.domElement);
  return renderer;
}

function addLights(scene: Scene): void {
  scene.add(new HemisphereLight(0xffffff, 0x334044, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.5, 1, 1);
  scene.add(sun);
}

function fpsCounter(onFps?: (fps: number) => void) {
  let frames = 0;
  let acc = 0;
  return (dt: number) => {
    if (!onFps) return;
    frames++;
    acc += dt;
    if (acc >= 1) {
      onFps(Math.round(frames / acc));
      frames = 0;
      acc = 0;
    }
  };
}

/** Matriz que leva do espaço do MindAR (px, origem no canto) ao da âncora (largura = 1, origem no centro). */
function postMatrixFor([w, h]: readonly [number, number]): Matrix4 {
  return new Matrix4().compose(new Vector3(w / 2, h / 2, 0), new Quaternion(), new Vector3(w, w, w));
}

export async function startARExperience(opts: ARExperienceOptions): Promise<Experience> {
  const { container, state, debug, reducedMotion } = opts;
  const engineFactory = opts.engineFactory ?? createMindAREngine;

  const cleanups: Array<() => void> = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]();
      } catch (err) {
        console.warn('[webar] falha ao desmontar', err);
      }
    }
    cleanups.length = 0;
  };

  try {
    // 1) Alvo compilado.
    state.set({ kind: 'loading', step: 'assets' });
    let targetBuffer: ArrayBuffer;
    try {
      const res = await fetch(opts.targetUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      targetBuffer = await res.arrayBuffer();
    } catch (err) {
      throw new ExperienceError('asset-missing', err);
    }

    // 2) Renderização.
    const renderer = createRenderer(container);
    cleanups.push(() => {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
    });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    addLights(scene);
    const anchor = new Group();
    anchor.matrixAutoUpdate = false;
    anchor.visible = false;
    scene.add(anchor);

    // 3) Câmera (após o gesto do usuário que chamou esta função).
    state.set({ kind: 'loading', step: 'camera' });
    const video = document.createElement('video');
    video.className = 'ar-video';
    container.prepend(video);
    cleanups.push(() => {
      stopCamera(video);
      video.remove();
    });
    await openCamera(video);
    if (stopped) return { stop };

    // 4) Motor de rastreamento.
    state.set({ kind: 'loading', step: 'engine' });
    let engine: TrackingEngine | null = null;
    let effects: EffectsBundle | null = null;
    let postMatrix = new Matrix4();
    let inputW = 0;
    let inputH = 0;
    let lastHint: DistanceHint = null;

    const setHint = (h: DistanceHint) => {
      if (h !== lastHint) {
        lastHint = h;
        opts.onDistanceHint?.(h);
      }
    };

    const onTargetUpdate = (targetIndex: number, worldMatrix: number[] | null) => {
      if (targetIndex !== 0 || stopped) return;
      if (worldMatrix === null) {
        anchor.visible = false;
        setHint(null);
        state.setTargetVisible(false);
        return;
      }
      anchor.matrix.fromArray(worldMatrix).multiply(postMatrix);
      anchor.matrixWorldNeedsUpdate = true;
      if (!anchor.visible) {
        anchor.visible = true;
        effects?.playIntro();
        state.setTargetVisible(true);
      }
      // Distância: tamanho aparente do alvo a partir da translação (px do alvo) e da focal do motor.
      if (!engine) return;
      const [mw] = engine.targetDimensions[0];
      const dist = Math.hypot(worldMatrix[12], worldMatrix[13], worldMatrix[14]);
      const focal = inputH / 2 / Math.tan((22.5 * Math.PI) / 180);
      const apparent = (focal * mw) / dist / Math.min(inputW, inputH);
      setHint(apparent < MIN_APPARENT ? 'too-far' : apparent > MAX_APPARENT ? 'too-close' : null);
    };

    const createEngine = async () => {
      syncVideoSize(video);
      inputW = video.videoWidth;
      inputH = video.videoHeight;
      const e = await engineFactory({ video, targetBuffer, onTargetUpdate });
      if (stopped) {
        e.dispose();
        return;
      }
      engine = e;
      postMatrix = postMatrixFor(e.targetDimensions[0]);
      if (!effects) {
        const [w, h] = e.targetDimensions[0];
        effects = createFloatingShapes({ aspect: h / w, reducedMotion }, debug);
        anchor.add(effects.root);
      }
      resize();
      e.start(video);
    };

    const resize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      renderer.setSize(cw, ch, false);
      if (!engine || !inputW) return;
      // O vídeo é exibido com object-fit: cover; ajustamos o FOV para casar com a área visível.
      const proj = engine.getProjectionMatrix();
      const displayedH = Math.max(ch, cw / (inputW / inputH));
      camera.fov = (2 * Math.atan((1 / proj[5]) * (ch / displayedH)) * 180) / Math.PI;
      camera.near = proj[14] / (proj[10] - 1);
      camera.far = proj[14] / (proj[10] + 1);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
    };

    let restarting = false;
    const onResize = async () => {
      resize();
      // Ao girar o aparelho, a câmera passa a entregar quadros com largura/altura trocadas:
      // o motor foi configurado para as dimensões antigas e precisa ser recriado.
      if (!engine || restarting) return;
      if (video.videoWidth === inputW && video.videoHeight === inputH) return;
      restarting = true;
      try {
        engine.dispose();
        engine = null;
        anchor.visible = false;
        state.setTargetVisible(false);
        await createEngine();
      } catch (err) {
        console.error('[webar] falha ao reiniciar após rotação', err);
        state.set({ kind: 'error', error: 'engine' });
      } finally {
        restarting = false;
      }
    };
    window.addEventListener('resize', onResize);
    video.addEventListener('resize', onResize);
    cleanups.push(() => {
      window.removeEventListener('resize', onResize);
      video.removeEventListener('resize', onResize);
    });

    try {
      await createEngine();
    } catch (err) {
      throw new ExperienceError('engine', err);
    }
    cleanups.push(() => {
      engine?.dispose();
      engine = null;
      effects?.dispose();
    });
    if (stopped) return { stop };

    // Pausa processamento quando a aba fica oculta (economia de bateria e calor).
    const onVisibility = () => {
      if (!engine) return;
      if (document.hidden) {
        engine.stop();
      } else {
        void video.play().catch(() => {});
        engine.start(video);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // 5) Loop de renderização.
    const clock = new Clock();
    const tickFps = fpsCounter(opts.onFps);
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      tickFps(dt);
      if (anchor.visible) effects?.update(dt);
      renderer.render(scene, camera);
    });

    state.set({ kind: 'scanning' });
    return { stop };
  } catch (err) {
    stop();
    throw err;
  }
}

export interface DemoExperienceOptions extends CommonOptions {
  imageUrl: string;
  aspect: number;
}

/**
 * Modo demonstrativo sem câmera: a obra como plano texturizado com os mesmos efeitos,
 * câmera orbitando suavemente e arrasto para girar. Não é rastreamento — é uma prévia.
 */
export function startDemoExperience(opts: DemoExperienceOptions): Experience {
  const { container, aspect, reducedMotion, debug } = opts;
  const renderer = createRenderer(container);
  const scene = new Scene();
  addLights(scene);
  const camera = new PerspectiveCamera(40, 1, 0.01, 50);

  const artwork = new Group();
  scene.add(artwork);
  const planeGeo = new PlaneGeometry(1, aspect);
  const planeMat = new MeshBasicMaterial({ color: 0xffffff });
  const texture = new TextureLoader().load(opts.imageUrl, (t) => {
    t.colorSpace = SRGBColorSpace;
    planeMat.map = t;
    planeMat.needsUpdate = true;
  });
  artwork.add(new Mesh(planeGeo, planeMat));
  const effects = createFloatingShapes({ aspect, reducedMotion }, debug);
  artwork.add(effects.root);
  effects.playIntro();

  let yaw = 0.35;
  let pitch = 0.25;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.006;
    pitch = Math.max(-0.9, Math.min(0.9, pitch + (e.clientY - lastY) * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = () => (dragging = false);
  const el = renderer.domElement;
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  // Distância da câmera que enquadra a obra inteira (com margem) em qualquer proporção de tela.
  let radius = 2;
  const resize = () => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    const halfV = Math.tan((camera.fov * Math.PI) / 360);
    const halfH = halfV * camera.aspect;
    radius = Math.max(0.62 / halfH, (aspect * 0.62) / halfV) + 0.2;
  };
  resize();
  window.addEventListener('resize', resize);

  const clock = new Clock();
  const tickFps = fpsCounter(opts.onFps);
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    tickFps(dt);
    if (!dragging && !reducedMotion) yaw += dt * 0.12;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius);
    camera.lookAt(0, 0, 0.15);
    effects.update(dt);
    renderer.render(scene, camera);
  });

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      effects.dispose();
      planeGeo.dispose();
      planeMat.dispose();
      texture.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
