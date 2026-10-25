import { describe, expect, it, vi } from 'vitest';
import { TrackingStateMachine } from './trackingState';

describe('TrackingStateMachine', () => {
  it('ignora found/lost fora da sessão AR (nunca simula rastreamento)', () => {
    const sm = new TrackingStateMachine();
    sm.setTargetVisible(true);
    expect(sm.state.kind).toBe('idle');
    sm.set({ kind: 'loading', step: 'engine' });
    sm.setTargetVisible(true);
    expect(sm.state.kind).toBe('loading');
  });

  it('segue scanning → found → lost → found', () => {
    const sm = new TrackingStateMachine();
    sm.set({ kind: 'scanning' });
    sm.setTargetVisible(false);
    expect(sm.state.kind).toBe('scanning');
    sm.setTargetVisible(true);
    expect(sm.state.kind).toBe('found');
    sm.setTargetVisible(false);
    expect(sm.state.kind).toBe('lost');
    sm.setTargetVisible(false);
    expect(sm.state.kind).toBe('lost');
    sm.setTargetVisible(true);
    expect(sm.log.map((e) => e.kind)).toEqual(['scanning', 'found', 'lost', 'found']);
  });

  it('notifica ouvintes apenas em mudanças e permite cancelar', () => {
    const sm = new TrackingStateMachine();
    const fn = vi.fn();
    const off = sm.subscribe(fn);
    sm.set({ kind: 'scanning' });
    sm.set({ kind: 'scanning' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith({ kind: 'scanning' }, { kind: 'idle' });
    off();
    sm.set({ kind: 'found' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('sempre emite novos erros e etapas de loading', () => {
    const sm = new TrackingStateMachine();
    const fn = vi.fn();
    sm.subscribe(fn);
    sm.set({ kind: 'loading', step: 'assets' });
    sm.set({ kind: 'loading', step: 'camera' });
    sm.set({ kind: 'error', error: 'permission-denied' });
    sm.set({ kind: 'error', error: 'permission-denied' });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('limita o log local a 200 entradas', () => {
    const sm = new TrackingStateMachine();
    sm.set({ kind: 'scanning' });
    for (let i = 0; i < 300; i++) {
      sm.setTargetVisible(true);
      sm.setTargetVisible(false);
    }
    expect(sm.log.length).toBe(200);
  });
});
