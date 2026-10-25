import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import vercel from './vercel.json' with { type: 'json' };

// HTTPS local (certificado autoassinado) só quando pedido: `npm run dev:https`.
// Necessário para abrir a câmera no celular pela rede local; localhost já é contexto seguro.
const useHttps = process.env.HTTPS === '1';

export default defineConfig({
  base: './',
  plugins: useHttps ? [basicSsl()] : [],
  server: { host: true },
  // `vite preview` serve com os mesmos cabeçalhos de produção (CSP etc.), para que
  // o teste E2E pegue violações de CSP antes do deploy.
  preview: { host: true, headers: Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value])) },
  optimizeDeps: {
    // Bundle pré-compilado e grande (inclui TensorFlow.js e workers inline); não reprocessar.
    exclude: ['mind-ar'],
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: { main: 'index.html', imprimir: 'imprimir.html' },
    },
    // O chunk do MindAR (~2 MB) é carregado sob demanda, só ao iniciar a experiência.
    chunkSizeWarningLimit: 2600,
  },
});
