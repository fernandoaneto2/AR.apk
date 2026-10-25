// Contrato do motor de rastreamento. O resto do app depende só desta interface, para que
// MindAR possa ser trocado no futuro (plano mestre, seção 12: evitar acoplamento a um SDK).

export interface TrackingEngine {
  /** Dimensões (px) de cada alvo do arquivo compilado, na ordem do targetIndex. */
  readonly targetDimensions: ReadonlyArray<readonly [number, number]>;
  /** Começa a processar quadros do vídeo. */
  start(video: HTMLVideoElement): void;
  /** Para de processar quadros (pode ser retomado com start). */
  stop(): void;
  /** Libera worker, tensores e listeners. A instância não pode mais ser usada. */
  dispose(): void;
  /** Matriz de projeção OpenGL (16 números, column-major) da câmera virtual do motor. */
  getProjectionMatrix(): number[];
}

/**
 * Chamado a cada quadro processado com o alvo visível (matriz model-view column-major,
 * unidades = pixels da imagem-alvo) ou com `null` quando o alvo deixa de ser rastreado.
 */
export type TargetUpdateHandler = (targetIndex: number, worldMatrix: number[] | null) => void;

export interface EngineFactoryOptions {
  video: HTMLVideoElement;
  targetBuffer: ArrayBuffer;
  onTargetUpdate: TargetUpdateHandler;
}

export type EngineFactory = (options: EngineFactoryOptions) => Promise<TrackingEngine>;
