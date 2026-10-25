import './styles/main.css';
import { ExperienceError } from './ar/camera';
import { startARExperience, startDemoExperience, type Experience } from './ar/createExperience';
import { TrackingStateMachine } from './ar/trackingState';
import { EXAMPLE_ID, MAX_SIMULTANEOUS_TARGETS, listEntries, type ArtworkEntry } from './artworks/catalog';
import { detectArtworkQuad, loadImage, toCanvas, warpQuad } from './artworks/imageTools';
import { registerArtwork, type PipelineStep } from './artworks/pipeline';
import { deleteArtwork, saveArtwork } from './artworks/store';
import { Cropper } from './ui/cropper';
import { icons } from './ui/icons';
import { experienceUrl, qrSvg } from './ui/qr';
import { StatusOverlay } from './ui/StatusOverlay';
import type { ParticleMotion, ParticleShape } from './scene/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const screens = { home: $('home'), create: $('create'), detail: $('detail'), ar: $('ar') };
type ScreenName = keyof typeof screens;
const stage = $('ar-stage');
const helpDialog = $<HTMLDialogElement>('help');

const state = new TrackingStateMachine();
const overlay = new StatusOverlay(debug);
state.subscribe((s) => {
  overlay.render(s);
  if (debug) console.info('[webar] estado', s);
});

let entries: ArtworkEntry[] = [];
let current: Experience | null = null;
let starting = false;
let lastARTargets: ArtworkEntry[] = [];

function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(Number(t.dataset.timer));
  t.dataset.timer = String(setTimeout(() => (t.hidden = true), 3800));
}

function show(name: ScreenName): void {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  document.body.classList.toggle('in-ar', name === 'ar');
  if (name !== 'ar') window.scrollTo(0, 0);
}

// ---------------- Navegação (hash + botão voltar do sistema) ----------------
type Route = { name: 'home' } | { name: 'create' } | { name: 'detail'; id: string } | { name: 'ar' };

function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'nova') return { name: 'create' };
  if (h.startsWith('obra/')) return { name: 'detail', id: decodeURIComponent(h.slice(5)) };
  if (h === 'ar') return { name: 'ar' };
  return { name: 'home' };
}

function navigate(route: Route, replace = false): void {
  const hash = route.name === 'home' ? '' : route.name === 'create' ? '#nova' : route.name === 'detail' ? `#obra/${encodeURIComponent(route.id)}` : '#ar';
  history[replace ? 'replaceState' : 'pushState'](null, '', hash || location.pathname + location.search);
  void render(route);
}

window.addEventListener('popstate', () => void render(parseRoute()));

async function render(route: Route): Promise<void> {
  if (route.name !== 'ar') teardown();
  if (route.name !== 'create') resetCreate();
  switch (route.name) {
    case 'home':
      await renderHome();
      return show('home');
    case 'create':
      return show('create');
    case 'detail':
      return renderDetail(route.id);
    case 'ar':
      // A câmera só abre por gesto do usuário; ao chegar aqui pelo histórico, volta ao início.
      if (!current && !starting) return navigate({ name: 'home' }, true);
      return show('ar');
  }
}

// ---------------- Início ----------------
$('btn-scan').innerHTML = `${icons.camera}<span>Apontar para uma obra</span>`;
$('btn-new').innerHTML = `${icons.plus}<span>Cadastrar nova obra</span>`;

async function renderHome(): Promise<void> {
  entries = await listEntries();
  const list = $('gallery');
  const userCount = entries.filter((e) => !e.builtin).length;
  $('gallery-empty').hidden = userCount > 0;
  list.replaceChildren(
    ...entries.map((e) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'art-card';
      a.href = `#obra/${encodeURIComponent(e.id)}`;
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        navigate({ name: 'detail', id: e.id });
      });
      const img = document.createElement('img');
      img.src = e.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      const body = document.createElement('span');
      body.className = 'art-card-body';
      const name = document.createElement('strong');
      name.textContent = e.name;
      const meta = document.createElement('span');
      meta.className = 'art-card-meta';
      meta.textContent = e.builtin ? 'Exemplo' : e.quality ? `Reconhecimento ${e.quality.score}/100` : '';
      body.append(name, meta);
      a.append(img, body);
      li.append(a);
      return li;
    }),
  );
}

// No computador (ponteiro fino, sem toque), oferece um QR Code para continuar no celular.
if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  qrSvg(experienceUrl())
    .then((svg) => {
      $('handoff-qr').innerHTML = svg;
      $('handoff').hidden = false;
    })
    .catch((err) => console.warn('[webar] QR indisponível', err));
}

// ---------------- AR ----------------
function teardown(): void {
  current?.stop();
  current = null;
  overlay.setDistanceHint(null);
  overlay.setCameraHint(null);
  overlay.setArtwork(null);
}

async function startAR(targets: ArtworkEntry[]): Promise<void> {
  if (starting) return;
  starting = true;
  teardown();
  lastARTargets = targets;
  overlay.setTargets(targets);
  if (parseRoute().name !== 'ar') history.pushState(null, '', '#ar');
  show('ar');
  try {
    current = await startARExperience({
      container: stage,
      artworks: targets,
      state,
      debug,
      reducedMotion,
      onDistanceHint: (h) => overlay.setDistanceHint(h),
      onCameraHint: (h) => overlay.setCameraHint(h),
      onArtwork: (a) => overlay.setArtwork(a),
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

function startDemo(artwork: ArtworkEntry): void {
  if (parseRoute().name !== 'ar') history.pushState(null, '', '#ar');
  teardown();
  state.set({ kind: 'idle' });
  overlay.setTargets([]);
  show('ar');
  overlay.renderDemo();
  try {
    current = startDemoExperience({ container: stage, artwork, reducedMotion, debug, onFps: debug ? (f) => overlay.setFps(f) : undefined });
  } catch (err) {
    console.error('[webar] falha na prévia', err);
    state.set({ kind: 'error', error: err instanceof ExperienceError ? err.kind : 'generic' });
  }
}

function exitAR(): void {
  teardown();
  state.set({ kind: 'idle' });
  if (parseRoute().name === 'ar' && history.length > 1) history.back();
  else navigate({ name: 'home' }, true);
}

/** Todas as obras (cadastradas primeiro), até o limite de reconhecimento simultâneo. */
async function allTargets(): Promise<ArtworkEntry[]> {
  if (entries.length === 0) entries = await listEntries();
  return entries.slice(0, MAX_SIMULTANEOUS_TARGETS);
}

// A experiência só começa por gesto explícito do usuário (requisito de permissão da câmera).
$('btn-scan').addEventListener('click', () => void allTargets().then(startAR));
$('btn-retry').addEventListener('click', () => void startAR(lastARTargets));
$('btn-error-back').addEventListener('click', exitAR);
$('btn-close').addEventListener('click', exitAR);
$('btn-help').addEventListener('click', () => helpDialog.showModal());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !screens.ar.hidden && !helpDialog.open) exitAR();
});
// Garante que a câmera seja liberada ao sair da página (inclusive bfcache no iOS).
window.addEventListener('pagehide', teardown);

// ---------------- Nova obra ----------------
$('btn-new').addEventListener('click', () => navigate({ name: 'create' }));
$('create-back').innerHTML = icons.back;
$('create-back').addEventListener('click', () => (history.length > 1 ? history.back() : navigate({ name: 'home' })));
$('lbl-camera').innerHTML = `${icons.camera}<span>Fotografar a obra</span>`;
$('lbl-gallery').innerHTML = `${icons.image}<span>Escolher da galeria</span>`;

const chkRights = $<HTMLInputElement>('chk-rights');
const inCamera = $<HTMLInputElement>('in-camera');
const inGallery = $<HTMLInputElement>('in-gallery');
let cropper: Cropper | null = null;
let sourceCanvas: HTMLCanvasElement | null = null;
let processing: AbortController | null = null;

function setStep(step: 'pick' | 'crop' | 'process'): void {
  $('step-pick').hidden = step !== 'pick';
  $('step-crop').hidden = step !== 'crop';
  $('step-process').hidden = step !== 'process';
  window.scrollTo(0, 0);
}

function resetCreate(): void {
  processing?.abort();
  processing = null;
  cropper?.destroy();
  cropper = null;
  sourceCanvas = null;
  inCamera.value = '';
  inGallery.value = '';
  $<HTMLInputElement>('in-name').value = '';
  setStep('pick');
}

function syncRights(): void {
  for (const input of [inCamera, inGallery]) {
    input.disabled = !chkRights.checked;
    input.parentElement!.setAttribute('aria-disabled', String(!chkRights.checked));
  }
}
chkRights.addEventListener('change', syncRights);

async function onFile(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Escolha um arquivo de imagem.');
  try {
    const img = await loadImage(file);
    // Até 1600 px para recorte: suficiente para a imagem-alvo final (1024 px) após correção.
    sourceCanvas = toCanvas(img, 1600);
  } catch {
    return toast('Não foi possível abrir esta imagem. Tente JPG ou PNG.');
  }
  setStep('crop');
  cropper ??= new Cropper($('cropper-host'));
  autoDetect();
}

function autoDetect(): void {
  if (!sourceCanvas || !cropper) return;
  const quad = detectArtworkQuad(sourceCanvas);
  cropper.setImage(sourceCanvas, quad ?? Cropper.fullQuad(sourceCanvas));
  $('crop-msg').textContent = quad
    ? 'Detectamos a obra automaticamente. Ajuste os cantos se precisar.'
    : 'Não detectamos a borda com segurança: ajuste os cantos à mão (ou use a imagem inteira, se a foto já for só a obra).';
}

inCamera.addEventListener('change', () => void onFile(inCamera));
inGallery.addEventListener('change', () => void onFile(inGallery));
$('btn-crop-auto').addEventListener('click', autoDetect);
$('btn-crop-full').addEventListener('click', () => sourceCanvas && cropper?.setQuad(Cropper.fullQuad(sourceCanvas)));
$('btn-repick').addEventListener('click', () => resetCreate());
$('btn-cancel').addEventListener('click', () => {
  processing?.abort();
  setStep('crop');
});

const STEP_ORDER: PipelineStep[] = ['analyze', 'compile', 'ai', 'save'];
function markStep(step: PipelineStep, progress: number | undefined, useAI: boolean): void {
  const idx = STEP_ORDER.indexOf(step);
  document.querySelectorAll<HTMLElement>('.progress-list li').forEach((li) => {
    const i = STEP_ORDER.indexOf(li.dataset.step as PipelineStep);
    li.classList.toggle('done', i < idx);
    li.classList.toggle('active', i === idx);
    li.hidden = li.dataset.step === 'ai' && !useAI;
  });
  $('compile-pct').textContent = step === 'compile' && progress !== undefined ? `${Math.round(progress)}%` : '';
  const fixed = { analyze: 2, compile: 5, ai: 82, save: 97 } as const;
  const pct = step === 'compile' ? 5 + (progress ?? 0) * (useAI ? 0.75 : 0.9) : fixed[step];
  $('process-bar').style.width = `${Math.min(100, pct)}%`;
}

$('btn-process').addEventListener('click', async () => {
  if (!sourceCanvas || !cropper) return;
  const useAI = $<HTMLInputElement>('chk-ai').checked;
  const image = warpQuad(sourceCanvas, cropper.getQuad());
  if (Math.min(image.width, image.height) < 240) return toast('A área recortada ficou pequena demais. Afaste os cantos.');
  setStep('process');
  markStep('analyze', undefined, useAI);
  const controller = new AbortController();
  processing = controller;
  try {
    const saved = await registerArtwork(image, {
      name: $<HTMLInputElement>('in-name').value,
      useAI,
      signal: controller.signal,
      onStep: (s, p) => markStep(s, p, useAI),
    });
    processing = null;
    if (saved.ai.error) toast(saved.ai.error);
    entries = await listEntries();
    navigate({ name: 'detail', id: saved.id }, true);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    console.error('[webar] falha no cadastro', err);
    toast('Não foi possível criar a experiência com esta imagem. Tente outra foto.');
    setStep('crop');
  }
});

// ---------------- Detalhes da obra ----------------
$('detail-back').innerHTML = icons.back;
$('detail-back').addEventListener('click', () => navigate({ name: 'home' }));
$('btn-detail-ar').innerHTML = `${icons.camera}<span>Experimentar em AR</span>`;
$('btn-detail-demo').innerHTML = `${icons.cube}<span>Prévia 3D</span>`;

let detailEntry: ArtworkEntry | null = null;
const LEVEL_TEXT = { otima: 'ótimo', boa: 'bom', fraca: 'fraco', ruim: 'ruim' } as const;

async function renderDetail(id: string): Promise<void> {
  if (!entries.some((e) => e.id === id)) entries = await listEntries();
  const e = entries.find((x) => x.id === id);
  if (!e) {
    toast('Obra não encontrada neste aparelho.');
    return navigate({ name: 'home' }, true);
  }
  detailEntry = e;
  $('detail-title').textContent = e.name;
  const img = $<HTMLImageElement>('detail-img');
  img.src = e.imageUrl;
  img.alt = e.description || e.name;
  const nameInput = $<HTMLInputElement>('detail-name');
  nameInput.value = e.name;
  nameInput.disabled = e.builtin;
  $('detail-desc').textContent = e.description;
  $('btn-detail-delete').hidden = e.builtin;

  const q = e.quality;
  const gauge = $('q-gauge');
  if (q) {
    $('q-score').textContent = String(q.score);
    gauge.style.setProperty('--p', String(q.score));
    gauge.dataset.level = q.level;
    gauge.setAttribute('aria-label', `Nota de reconhecimento ${q.score} de 100`);
    $('q-level').textContent = LEVEL_TEXT[q.level];
    $('q-meta').textContent = `${q.featureCount} pontos de reconhecimento · ${Math.round(q.coverage * 100)}% da obra com detalhes`;
    const tips = [...(e.stored?.ai.tips ?? []), ...q.tips].slice(0, 5);
    $('q-tips').replaceChildren(
      ...tips.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );
  } else {
    $('q-score').textContent = '★';
    gauge.style.setProperty('--p', '100');
    gauge.dataset.level = 'otima';
    gauge.setAttribute('aria-label', 'Obra de exemplo, otimizada para reconhecimento');
    $('q-level').textContent = 'ótimo';
    $('q-meta').textContent = 'Obra de exemplo criada para reconhecimento. Imprima em imprimir.html.';
    $('q-tips').replaceChildren();
  }
  const ai = e.stored?.ai;
  $('ai-note').textContent = ai?.used
    ? 'Título, descrição e efeitos sugeridos pela IA (Claude). Ajuste à vontade.'
    : (ai?.error ?? (e.builtin ? '' : 'Efeitos escolhidos pela análise local da imagem.'));

  const sc = e.scene;
  $('detail-caption').textContent = sc.caption ? `“${sc.caption}”` : '';
  $<HTMLInputElement>('fx-layers').checked = sc.effects.layers.enabled;
  $<HTMLInputElement>('fx-particles').checked = sc.effects.particles.enabled;
  $<HTMLInputElement>('fx-aura').checked = sc.effects.aura.enabled;
  $<HTMLInputElement>('fx-orbit').checked = sc.effects.orbit.enabled;
  $<HTMLSelectElement>('fx-shape').value = sc.effects.particles.shape;
  $<HTMLSelectElement>('fx-motion').value = sc.effects.particles.motion;
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#detail .toggles input, #detail .selects select').forEach((el) => (el.disabled = e.builtin));
  $('detail-palette').replaceChildren(
    ...sc.palette.map((c) => {
      const s = document.createElement('span');
      s.style.background = c;
      s.title = c;
      return s;
    }),
  );
  show('detail');
}

async function persistDetail(): Promise<void> {
  const e = detailEntry;
  if (!e?.stored) return;
  const s = e.scene;
  s.effects.layers.enabled = $<HTMLInputElement>('fx-layers').checked;
  s.effects.particles.enabled = $<HTMLInputElement>('fx-particles').checked;
  s.effects.aura.enabled = $<HTMLInputElement>('fx-aura').checked;
  s.effects.orbit.enabled = $<HTMLInputElement>('fx-orbit').checked;
  s.effects.particles.shape = $<HTMLSelectElement>('fx-shape').value as ParticleShape;
  s.effects.particles.motion = $<HTMLSelectElement>('fx-motion').value as ParticleMotion;
  const name = $<HTMLInputElement>('detail-name').value.trim() || e.name;
  e.name = name;
  $('detail-title').textContent = name;
  await saveArtwork({ ...e.stored, name, scene: s, updatedAt: Date.now() });
}

document
  .querySelectorAll<HTMLElement>('#detail .toggles input, #detail .selects select, #detail-name')
  .forEach((el) => el.addEventListener('change', () => void persistDetail()));
$('btn-detail-ar').addEventListener('click', () => detailEntry && void startAR([detailEntry]));
$('btn-detail-demo').addEventListener('click', () => detailEntry && startDemo(detailEntry));
$('btn-detail-delete').addEventListener('click', async () => {
  const e = detailEntry;
  if (!e || e.builtin || e.id === EXAMPLE_ID) return;
  if (!confirm(`Excluir “${e.name}” deste aparelho?`)) return;
  await deleteArtwork(e.id);
  entries = [];
  navigate({ name: 'home' }, true);
});

// ---------------- Início do app ----------------
syncRights();
void render(parseRoute());

if (debug) {
  // Exposto apenas em modo debug, para QA manual e testes automatizados.
  Object.assign(window, { __webar: { state, startAR: async () => startAR(await allTargets()), exit: exitAR, listEntries } });
}
