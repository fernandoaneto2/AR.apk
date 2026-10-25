// Obras cadastradas, guardadas no próprio aparelho (IndexedDB). Nada sai do celular,
// exceto a imagem enviada à IA quando o usuário permite.

import type { QualityReport } from './analyze';
import type { SceneConfig } from '../scene/types';

export interface StoredArtwork {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  image: Blob; // JPEG já recortado/corrigido (é a imagem-alvo)
  width: number;
  height: number;
  mind: ArrayBuffer; // alvo compilado
  featurePoints: Array<{ x: number; y: number }>;
  quality: QualityReport;
  scene: SceneConfig;
  ai: { used: boolean; model?: string; tips?: string[]; error?: string };
}

const DB = 'webar-arte-expandida';
const STORE = 'artworks';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function listArtworks(): Promise<StoredArtwork[]> {
  try {
    const all = await tx<StoredArtwork[]>('readonly', (s) => s.getAll() as IDBRequest<StoredArtwork[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.warn('[webar] IndexedDB indisponível', err);
    return [];
  }
}

export const getArtwork = (id: string) => tx<StoredArtwork | undefined>('readonly', (s) => s.get(id) as IDBRequest<StoredArtwork | undefined>);
export const saveArtwork = (a: StoredArtwork) => tx('readwrite', (s) => s.put(a));
export const deleteArtwork = (id: string) => tx('readwrite', (s) => s.delete(id));

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
