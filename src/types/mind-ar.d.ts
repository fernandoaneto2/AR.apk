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

  export interface Keyframe {
    maximaPoints: Array<{ x: number; y: number }>;
    minimaPoints: Array<{ x: number; y: number }>;
    width: number;
    height: number;
    scale: number;
  }

  export interface TargetData {
    targetImage: { width: number; height: number };
    matchingData: Keyframe[];
    trackingData: Array<{ points: Array<{ x: number; y: number }>; width: number; height: number; scale: number }>;
  }

  export class Compiler {
    data: TargetData[];
    compileImageTargets(images: Array<{ width: number; height: number } & CanvasImageSource>, progress: (percent: number) => void): Promise<TargetData[]>;
    exportData(): Uint8Array;
    importData(buffer: ArrayBuffer | Uint8Array): TargetData[];
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
