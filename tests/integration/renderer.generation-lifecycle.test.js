'use strict';

const { createGenerationLifecycle } = require('../../src/renderer/generation-lifecycle');

function createHarness(overrides = {}) {
  const calls = [];
  const generation = {
    requestId: '1',
    discardAssistantBubble: false,
    suppressCancelledStatus: false,
    assistantWrapper: { id: 'wrapper-1' },
    ...overrides.generation,
  };

  const lifecycle = createGenerationLifecycle({
    requestId: '1',
    generation,
    paramsSnapshot: { model: 'llama3' },
    sessionId: 'session-1',
    clearUiState: jest.fn(() => calls.push('clear-ui')),
    onRemoveThinking: jest.fn(() => calls.push('remove-thinking')),
    onAppendContent: jest.fn((text) => calls.push(['append', text])),
    onCancelled: jest.fn(({ responseText }) => calls.push(['cancelled', responseText])),
    onError: jest.fn((error) => calls.push(['error', error])),
    onPersistAssistant: jest.fn(async ({ responseText }) => calls.push(['persist', responseText])),
    onDiscardAssistant: jest.fn(() => calls.push('discard')),
    onAfterFinish: jest.fn(() => calls.push('after-finish')),
    onFinishResolved: jest.fn(() => calls.push('resolved')),
    unsubChunk: jest.fn(() => calls.push('unsub-chunk')),
    unsubError: jest.fn(() => calls.push('unsub-error')),
  });

  return {
    calls,
    generation,
    lifecycle,
  };
}

describe('renderer generation lifecycle', () => {
  test('異なる requestId の chunk を無視する', async () => {
    const { lifecycle, calls } = createHarness();

    await lifecycle.handleChunk({ requestId: 'other', content: 'ignored', done: false });

    expect(calls).toEqual([]);
    expect(lifecycle.getResponseText()).toBe('');
  });

  test('同じ requestId の chunk を蓄積し done で一度だけ finish する', async () => {
    const { lifecycle, calls } = createHarness();

    await lifecycle.handleChunk({ requestId: '1', content: 'A', done: false });
    await lifecycle.handleChunk({ requestId: '1', content: 'B', done: true });
    await lifecycle.handleChunk({ requestId: '1', content: 'C', done: true });

    expect(lifecycle.getResponseText()).toBe('ABC');
    expect(calls).toEqual([
      'remove-thinking',
      ['append', 'A'],
      ['append', 'AB'],
      'unsub-chunk',
      'unsub-error',
      'clear-ui',
      ['persist', 'AB'],
      'after-finish',
      'resolved',
      ['append', 'ABC'],
    ]);
  });

  test('cancel 時は requestId 一致時のみキャンセル経路に入り永続化しない', async () => {
    const { lifecycle, calls } = createHarness();

    await lifecycle.handleError({ requestId: '1', error: 'キャンセルされました', cancelled: true });

    expect(calls).toEqual([
      'remove-thinking',
      ['cancelled', ''],
      'unsub-chunk',
      'unsub-error',
      'clear-ui',
      'after-finish',
      'resolved',
    ]);
  });

  test('error 時は error 経路に入り永続化しない', async () => {
    const { lifecycle, calls } = createHarness();

    await lifecycle.handleError({ requestId: '1', error: 'HTTP 503: busy', cancelled: false });

    expect(calls).toEqual([
      'remove-thinking',
      ['error', 'HTTP 503: busy'],
      'unsub-chunk',
      'unsub-error',
      'clear-ui',
      'after-finish',
      'resolved',
    ]);
  });

  test('discardAssistantBubble が立っていると bubble を破棄する', async () => {
    const { lifecycle, calls } = createHarness({
      generation: { discardAssistantBubble: true },
    });

    await lifecycle.handleError({ requestId: '1', error: 'キャンセルされました', cancelled: true });

    expect(calls).toContain('discard');
    expect(calls).not.toContainEqual(['persist', expect.anything()]);
  });
});