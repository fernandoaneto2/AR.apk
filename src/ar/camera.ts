import type { ErrorKind } from './trackingState';

export class ExperienceError extends Error {
  constructor(
    readonly kind: ErrorKind,
    override readonly cause?: unknown,
  ) {
    super(kind);
    this.name = 'ExperienceError';
  }
}

/** Traduz erros de getUserMedia para categorias exibíveis (plano, seção 06). */
export function classifyCameraError(err: unknown): ErrorKind {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'camera-busy';
    default:
      return 'camera-generic';
  }
}

/**
 * Abre a câmera traseira quando disponível. Deve ser chamada a partir de um gesto do
 * usuário. Nada é gravado ou enviado: o stream só alimenta um <video> local.
 */
export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!window.isSecureContext) throw new ExperienceError('insecure-context');
  if (!navigator.mediaDevices?.getUserMedia) throw new ExperienceError('unsupported');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch (err) {
    throw new ExperienceError(classifyCameraError(err), err);
  }

  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.muted = true;
  video.srcObject = stream;

  try {
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return resolve();
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(video.error), { once: true });
    });
    syncVideoSize(video);
    await video.play();
  } catch (err) {
    stopCamera(video);
    throw new ExperienceError('camera-generic', err);
  }
  return stream;
}

/** Encerra todas as tracks (apaga o indicador de câmera do sistema) e solta o <video>. */
export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) stream.getTracks().forEach((t) => t.stop());
  video.pause();
  video.srcObject = null;
}

/**
 * O TensorFlow.js (tf.browser.fromPixels, usado pelo MindAR) lê os atributos width/height do
 * <video>, não videoWidth/videoHeight. Sem isso os quadros chegam vazios e nada é detectado.
 * O tamanho na tela continua definido por CSS.
 */
export function syncVideoSize(video: HTMLVideoElement): void {
  video.width = video.videoWidth;
  video.height = video.videoHeight;
}
