// Tipagem mínima do que usamos de mind-ar@1.2.5 (o pacote não publica tipos).
// Fonte: node_modules/mind-ar/src/image-target/controller.js
declare module 'mind-ar/dist/mindar-image.prod.js' {
  export type MindARUpdate =
    | { type: 'updateMatrix'; targetIndex: number; worldMatrix: number[] | null }
    | { type: 'processDone' };

  export interface ControllerOptions {
    inputWidth: number;
    inputHeight: number;
    onUpdate?: ((data: MindARUpdate) => void) | null;
    debugMode?: boolean;
    maxTrack?: number;
    warmupTolerance?: number | null;
    missTolerance?: number | null;
    filterMinCF?: number | null;
    filterBeta?: number | null;
  }

  export class Controller {
    constructor(options: ControllerOptions);
    inputWidth: number;
    inputHeight: number;
    worker: Worker;
    addImageTargetsFromBuffer(buffer: ArrayBuffer): { dimensions: [number, number][] };
    dummyRun(input: HTMLVideoElement): void;
    processVideo(input: HTMLVideoElement): void;
    stopProcessVideo(): void;
    getProjectionMatrix(): number[];
    dispose(): void;
  }
}
