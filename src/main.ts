import './styles/main.css';
import { ARTWORK } from './config';
import { ExperienceError } from './ar/camera';
import { startARExperience, startDemoExperience, type Experience } from './ar/createExperience';
import { TrackingStateMachine } from './ar/trackingState';
import { StatusOverlay } from './ui/StatusOverlay';
import { icons } from './ui/icons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const home = $('home');
const arScreen = $('ar');
const stage = $('ar-stage');
const helpDialog = $<HTMLDialogElement>('help');

const state = new TrackingStateMachine();
const overlay = new StatusOverlay(debug);
state.subscribe((s) => {
  overlay.render(s);
  if (debug) console.info('[webar] estado', s);
});

// Tela inicial.
const preview = $<HTMLImageElement>('art-preview');
preview.src = ARTWORK.imageUrl;
preview.alt = `${ARTWORK.title}: ${ARTWORK.description}`;
$('art-title').textContent = ARTWORK.title;
$('art-meta').textContent = `${ARTWORK.author} · ${ARTWORK.year}`;
$('art-description').textContent = ARTWORK.description;
$('btn-start').innerHTML = `${icons.camera}<span>Iniciar experiência</span>`;
$('btn-demo').innerHTML = `${icons.cube}<span>Ver demonstração sem câmera</span>`;

let current: Experience | null = null;
let starting = false;

function showScreen(which: 'home' | 'ar'): void {
  home.hidden = which !== 'home';
  arScreen.hidden = which !== 'ar';
  document.body.classList.toggle('in-ar', which === 'ar');
}

function teardown(): void {
  current?.stop();
  current = null;
  overlay.setDistanceHint(null);
}

async function startAR(): Promise<void> {
  if (starting) return;
  starting = true;
  teardown();
  showScreen('ar');
  try {
    current = await startARExperience({
      container: stage,
      targetUrl: ARTWORK.targetUrl,
      state,
      debug,
      reducedMotion,
      onDistanceHint: (h) => overlay.setDistanceHint(h),
      onFps: debug ? (f) => overlay.setFps(f) : undefined,
    });
  } catch (err) {
    console.error('[webar] falha ao iniciar', err);
    const kind = err instanceof ExperienceError ? err.kind : 'generic';
    state.set({ kind: 'error', error: kind, detail: err instanceof Error ? err.message : String(err) });
  } finally {
    starting = false;
  }
}

function startDemo(): void {
  teardown();
  state.set({ kind: 'idle' });
  showScreen('ar');
  overlay.renderDemo();
  try {
    current = startDemoExperience({
      container: stage,
      imageUrl: ARTWORK.imageUrl,
      aspect: ARTWORK.aspect,
      reducedMotion,
      debug,
      onFps: debug ? (f) => overlay.setFps(f) : undefined,
    });
  } catch (err) {
    console.error('[webar] falha no modo demonstração', err);
    state.set({ kind: 'error', error: err instanceof ExperienceError ? err.kind : 'generic' });
  }
}

function exit(): void {
  teardown();
  state.set({ kind: 'idle' });
  showScreen('home');
  $('btn-start').focus();
}

// A experiência só começa por gesto explícito do usuário (requisito de permissão da câmera).
$('btn-start').addEventListener('click', () => void startAR());
$('btn-demo').addEventListener('click', startDemo);
$('btn-retry').addEventListener('click', () => void startAR());
$('btn-error-demo').addEventListener('click', startDemo);
$('btn-error-back').addEventListener('click', exit);
$('btn-close').addEventListener('click', exit);
$('btn-help').addEventListener('click', () => helpDialog.showModal());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !arScreen.hidden && !helpDialog.open) exit();
});
// Garante que a câmera seja liberada ao sair da página (inclusive bfcache no iOS).
window.addEventListener('pagehide', teardown);

if (debug) {
  // Exposto apenas em modo debug, para QA manual e testes automatizados.
  Object.assign(window, { __webar: { state, startAR, startDemo, exit } });
}
