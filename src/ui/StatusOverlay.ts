import type { DistanceHint } from '../ar/createExperience';
import type { CameraHint } from '../ar/frameAdvisor';
import type { ArtworkEntry } from '../artworks/catalog';
import type { ErrorKind, ExperienceState } from '../ar/trackingState';
import { icons } from './icons';

// Camada de interface da tela AR: status, dicas, loading e erros. Não conhece câmera nem Three.js.

interface ErrorCopy {
  title: string;
  text: string;
  steps?: string[];
  retry: boolean;
}

const ERRORS: Record<ErrorKind, ErrorCopy> = {
  'permission-denied': {
    title: 'Acesso à câmera negado',
    text: 'Precisamos da câmera para reconhecer a obra. Nada é gravado ou enviado.',
    steps: [
      'iPhone (Safari): toque em “aA” na barra de endereço › Ajustes do Site › Câmera › Permitir.',
      'Android (Chrome): toque no cadeado ao lado do endereço › Permissões › Câmera › Permitir.',
      'Depois, toque em “Tentar novamente”.',
    ],
    retry: true,
  },
  'no-camera': {
    title: 'Nenhuma câmera encontrada',
    text: 'Não encontramos uma câmera disponível neste aparelho.',
    steps: ['Use um celular ou tablet com câmera traseira.', 'Ou use a Prévia 3D na página da obra.'],
    retry: true,
  },
  'camera-busy': {
    title: 'Câmera em uso',
    text: 'Outro aplicativo ou aba pode estar usando a câmera.',
    steps: ['Feche outros apps que usam a câmera (videochamada, câmera, outras abas).', 'Toque em “Tentar novamente”.'],
    retry: true,
  },
  'camera-generic': {
    title: 'Não foi possível abrir a câmera',
    text: 'Ocorreu um erro ao iniciar a câmera.',
    steps: ['Recarregue a página e tente de novo.', 'Verifique se o navegador está atualizado.'],
    retry: true,
  },
  'insecure-context': {
    title: 'Conexão não segura',
    text: 'O navegador só libera a câmera em páginas HTTPS.',
    steps: ['Abra o endereço começando com https://.'],
    retry: false,
  },
  unsupported: {
    title: 'Navegador incompatível',
    text: 'Este navegador não oferece acesso à câmera para páginas web.',
    steps: ['iPhone: use o Safari (iOS 15 ou superior).', 'Android: use o Chrome atualizado.', 'Se abriu por um app (Instagram etc.), abra no navegador.'],
    retry: false,
  },
  webgl: {
    title: 'Gráficos 3D indisponíveis',
    text: 'Este navegador ou aparelho não suporta WebGL, necessário para os elementos 3D.',
    steps: ['Atualize o navegador ou tente outro aparelho.'],
    retry: false,
  },
  'asset-missing': {
    title: 'Arquivos da experiência não carregaram',
    text: 'Não foi possível baixar os dados de reconhecimento da obra.',
    steps: ['Verifique sua conexão (Wi-Fi ou 4G).', 'Toque em “Tentar novamente”.'],
    retry: true,
  },
  engine: {
    title: 'Falha no reconhecimento',
    text: 'O motor de reconhecimento de imagem não conseguiu iniciar neste aparelho.',
    steps: ['Feche outras abas e tente de novo.', 'Ou use a Prévia 3D na página da obra.'],
    retry: true,
  },
  generic: {
    title: 'Algo deu errado',
    text: 'Ocorreu um erro inesperado.',
    steps: ['Recarregue a página e tente novamente.'],
    retry: true,
  },
};

const CAMERA_HINTS: Record<string, string> = {
  dark: 'Está escuro: acenda uma luz ou aproxime-se de uma janela.',
  glare: 'Reflexo forte na imagem: incline um pouco o celular para tirar o brilho.',
  shaky: 'A imagem está tremendo: segure o celular firme por um instante.',
  blurry: 'A imagem está desfocada: afaste um pouco ou toque na tela para focar.',
  'frame-it': 'Enquadre a obra inteira, de frente, a cerca de 30–60 cm.',
  'not-registered': 'Ainda não reconheci. Confira se é uma das obras acima; obras parecidas não contam.',
};

const LOADING_TEXT = {
  assets: 'Carregando a experiência…',
  camera: 'Aguardando permissão da câmera…',
  engine: 'Preparando o reconhecimento…',
} as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class StatusOverlay {
  private readonly status = $('status');
  private readonly hint = $('hint');
  private readonly frame = $('scan-frame');
  private readonly loading = $('loading');
  private readonly loadingText = $('loading-text');
  private readonly error = $('error');
  private readonly fps = $('fps');
  private readonly targets = $('targets');
  private readonly caption = $('caption');
  private distanceHint: DistanceHint = null;
  private cameraHint: CameraHint = null;
  private state: ExperienceState = { kind: 'idle' };

  constructor(showFps: boolean) {
    $('btn-help').innerHTML = icons.help;
    $('btn-close').innerHTML = icons.close;
    $('error-icon').innerHTML = icons.alert;
    this.fps.hidden = !showFps;
  }

  render(state: ExperienceState): void {
    this.state = state;
    this.loading.hidden = state.kind !== 'loading';
    this.error.hidden = state.kind !== 'error';
    const tracking = state.kind === 'scanning' || state.kind === 'found' || state.kind === 'lost';
    this.status.hidden = !tracking;
    this.frame.hidden = !(state.kind === 'scanning' || state.kind === 'lost');
    this.targets.hidden = this.frame.hidden || this.targets.childElementCount === 0;
    if (state.kind !== 'found') this.caption.hidden = true;

    switch (state.kind) {
      case 'loading':
        this.loadingText.textContent = LOADING_TEXT[state.step];
        break;
      case 'scanning':
        this.setStatus('scan', 'Procurando a obra…', 'searching');
        break;
      case 'found':
        this.setStatus('check', 'Obra reconhecida', 'found');
        break;
      case 'lost':
        this.setStatus('scan', 'Obra perdida de vista', 'lost');
        break;
      case 'error':
        this.renderError(state.error);
        break;
    }
    this.renderHint();
  }

  /** Modo demonstrativo: sem câmera nem rastreamento, só a prévia 3D. */
  renderDemo(): void {
    this.render({ kind: 'idle' });
    this.status.hidden = false;
    this.setStatus('cube', 'Prévia 3D · arraste para girar', 'demo');
  }

  /** Miniaturas das obras que a câmera está procurando (evita "apontei para a obra errada"). */
  setTargets(artworks: ArtworkEntry[]): void {
    const label = document.createElement('span');
    label.textContent = artworks.length === 1 ? 'Procurando:' : `Procurando ${artworks.length} obras:`;
    const thumbs = artworks.slice(0, 6).map((a) => {
      const img = document.createElement('img');
      img.src = a.imageUrl;
      img.alt = a.name;
      img.title = a.name;
      return img;
    });
    this.targets.replaceChildren(label, ...thumbs);
  }

  /** Obra reconhecida: mostra título e a frase da curadoria/IA. */
  setArtwork(a: ArtworkEntry | null): void {
    if (!a) {
      this.caption.hidden = true;
      return;
    }
    const title = document.createElement('strong');
    title.textContent = a.name;
    this.caption.replaceChildren(title);
    if (a.scene.caption) {
      const p = document.createElement('span');
      p.textContent = a.scene.caption;
      this.caption.append(p);
    }
    this.caption.hidden = false;
  }

  setCameraHint(hint: CameraHint): void {
    this.cameraHint = hint;
    this.renderHint();
  }

  setDistanceHint(hint: DistanceHint): void {
    this.distanceHint = hint;
    this.renderHint();
  }

  setFps(fps: number): void {
    this.fps.textContent = `${fps} fps`;
  }

  private setStatus(icon: keyof typeof icons, text: string, mod: string): void {
    this.status.className = `status status--${mod}`;
    this.status.innerHTML = `${icons[icon]}<span>${text}</span>`;
  }

  private renderHint(): void {
    let text = '';
    if (this.state.kind === 'scanning' || this.state.kind === 'lost') {
      text = CAMERA_HINTS[this.cameraHint ?? 'none'] ?? '';
      if (!text) text = this.state.kind === 'lost' ? 'Aponte de novo para a obra para retomar.' : 'Aponte para a obra, inteira no quadro.';
    }
    else if (this.state.kind === 'found') {
      if (this.distanceHint === 'too-far') text = 'Aproxime-se um pouco da obra.';
      else if (this.distanceHint === 'too-close') text = 'Afaste-se um pouco para enquadrar a obra.';
    }
    this.hint.textContent = text;
    this.hint.hidden = text === '';
  }

  private renderError(kind: ErrorKind): void {
    const copy = ERRORS[kind];
    $('error-title').textContent = copy.title;
    $('error-text').textContent = copy.text;
    const steps = $('error-steps');
    steps.replaceChildren(
      ...(copy.steps ?? []).map((s) => {
        const li = document.createElement('li');
        li.textContent = s;
        return li;
      }),
    );
    $('btn-retry').hidden = !copy.retry;
    queueMicrotask(() => ($(copy.retry ? 'btn-retry' : 'btn-error-back') as HTMLButtonElement).focus());
  }
}
