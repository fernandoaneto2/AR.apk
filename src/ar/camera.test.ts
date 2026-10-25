import { describe, expect, it } from 'vitest';
import { classifyCameraError } from './camera';

const domError = (name: string) => new DOMException('x', name);

describe('classifyCameraError', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'camera-busy'],
    ['AbortError', 'camera-busy'],
    ['TypeError', 'camera-generic'],
  ])('%s → %s', (name, kind) => {
    expect(classifyCameraError(domError(name))).toBe(kind);
  });

  it('aceita Error comum com name legado (Chrome antigo)', () => {
    const err = new Error('legacy');
    err.name = 'PermissionDeniedError';
    expect(classifyCameraError(err)).toBe('permission-denied');
  });

  it('valores desconhecidos viram falha genérica', () => {
    expect(classifyCameraError('boom')).toBe('camera-generic');
    expect(classifyCameraError(undefined)).toBe('camera-generic');
  });
});
