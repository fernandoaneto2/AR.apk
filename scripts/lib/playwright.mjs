import { createRequire } from 'node:module';

// Playwright é opcional (usado só pelos scripts de arte/compilação). Tenta o import ESM
// local e, se falhar, o require (que respeita NODE_PATH de instalações globais).
export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return createRequire(import.meta.url)('playwright');
  }
}
