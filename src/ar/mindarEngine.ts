import type { EngineFactory, TrackingEngine } from './engine';

// Usamos o Controller de baixo nível do MindAR em vez de MindARThree porque este importa
// `sRGBEncoding`, removido do Three.js na r162 — incompatível com a versão fixada (0.186).
// Isso também nos dá controle sobre câmera, erros, resize e desmontagem.

export const createMindAREngine: EngineFactory = async ({ video, targetBuffer, onTargetUpdate }) => {
  // Import dinâmico: o bundle do MindAR (TensorFlow.js incluso) só baixa ao iniciar a experiência.
  const { Controller } = await import('mind-ar/dist/mindar-image.prod.js');

  const controller = new Controller({
    inputWidth: video.videoWidth,
    inputHeight: video.videoHeight,
    maxTrack: 1,
    // Valores padrão do MindAR; ajustar aqui após medições de jitter em campo.
    filterMinCF: null,
    filterBeta: null,
    warmupTolerance: null,
    missTolerance: null,
    onUpdate: (data) => {
      if (data.type === 'updateMatrix') onTargetUpdate(data.targetIndex, data.worldMatrix);
    },
  });

  // addImageTargetsFromBuffer consome o buffer (transfere para o worker); passamos uma cópia
  // para permitir reiniciar o motor (ex.: rotação do aparelho) sem baixar o .mind de novo.
  const { dimensions } = controller.addImageTargetsFromBuffer(targetBuffer.slice(0));
  if (dimensions.length === 0) throw new Error('O arquivo .mind não contém alvos.');

  // Aquece os kernels WebGL do TensorFlow.js (o primeiro quadro é lento sem isso).
  controller.dummyRun(video);

  let disposed = false;
  const engine: TrackingEngine = {
    targetDimensions: dimensions,
    start: (v) => {
      if (!disposed) controller.processVideo(v);
    },
    stop: () => controller.stopProcessVideo(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      controller.worker.terminate();
    },
    getProjectionMatrix: () => controller.getProjectionMatrix(),
  };
  return engine;
};
