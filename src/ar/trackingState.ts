// Estados da experiência (plano, seção 02) e uma pequena máquina de estados observável.

export type ErrorKind =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'camera-generic'
  | 'insecure-context'
  | 'unsupported'
  | 'webgl'
  | 'asset-missing'
  | 'engine'
  | 'generic';

export type ExperienceState =
  | { kind: 'idle' }
  | { kind: 'loading'; step: 'assets' | 'camera' | 'engine' }
  | { kind: 'scanning' }
  | { kind: 'found' }
  | { kind: 'lost' }
  | { kind: 'error'; error: ErrorKind; detail?: string };

export type StateListener = (state: ExperienceState, previous: ExperienceState) => void;

export class TrackingStateMachine {
  private current: ExperienceState = { kind: 'idle' };
  private readonly listeners = new Set<StateListener>();
  /** Timestamps locais (não enviados a lugar nenhum) para diagnóstico em QA. */
  readonly log: Array<{ at: number; kind: ExperienceState['kind'] }> = [];

  get state(): ExperienceState {
    return this.current;
  }

  set(next: ExperienceState): void {
    const prev = this.current;
    if (prev.kind === next.kind && prev.kind !== 'loading' && prev.kind !== 'error') return;
    this.current = next;
    this.log.push({ at: performance.now(), kind: next.kind });
    if (this.log.length > 200) this.log.shift();
    this.listeners.forEach((l) => l(next, prev));
  }

  /** Alvo encontrado/perdido. Só tem efeito durante a sessão AR (nunca simula sucesso). */
  setTargetVisible(visible: boolean): void {
    const k = this.current.kind;
    if (k !== 'scanning' && k !== 'found' && k !== 'lost') return;
    if (visible) this.set({ kind: 'found' });
    else if (k === 'found') this.set({ kind: 'lost' });
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
