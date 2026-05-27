'use strict';

const { EventEmitter } = require('node:events');

const { ollamaChatStream } = require('../../src/ollama');

function createHttpHarness(statusCode = 200) {
  let response = null;
  let responseCallback = null;

  const req = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn(() => {
    response = new EventEmitter();
    response.statusCode = statusCode;
    responseCallback(response);
  });
  req.destroy = jest.fn(() => req.emit('error', new Error('socket closed')));
  req.setTimeout = jest.fn();

  const httpModule = {
    request: jest.fn((_options, callback) => {
      responseCallback = callback;
      return req;
    }),
  };

  return {
    httpModule,
    req,
    emitData(chunk) { response.emit('data', chunk); },
    emitEnd() { response.emit('end'); },
  };
}

function makeStream(deps = {}) {
  const onChunk = jest.fn();
  const onDone = jest.fn();
  const onError = jest.fn();
  const onThinking = jest.fn();

  const harness = createHttpHarness();
  ollamaChatStream(
    { requestId: 'r', model: 'deepseek-r1', messages: [] },
    onChunk,
    onDone,
    onError,
    { httpModule: harness.httpModule, activeRequests: new Map(), ...deps },
    onThinking,
  );

  return { harness, onChunk, onDone, onError, onThinking };
}

// ─────────────────────────────────────────────────────────────────────────────
// ネイティブ thinking フィールド（Ollama >= 0.7.0 + think: true）
// ─────────────────────────────────────────────────────────────────────────────

describe('ollamaChatStream — native thinking field', () => {
  test('message.thinking を onThinking へ転送し message.content を onChunk へ転送する', () => {
    const { harness, onChunk, onThinking, onDone } = makeStream();

    harness.emitData('{"message":{"thinking":"step 1","content":""}}\n');
    harness.emitData('{"message":{"thinking":"step 2","content":""}}\n');
    harness.emitData('{"message":{"thinking":"","content":"Answer"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    expect(onThinking).toHaveBeenNthCalledWith(1, 'step 1');
    expect(onThinking).toHaveBeenNthCalledWith(2, 'step 2');
    expect(onChunk).toHaveBeenCalledWith('Answer');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('onThinking が null のときも content は onChunk へ転送される', () => {
    const harness = createHttpHarness();
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    ollamaChatStream(
      { requestId: 'r', model: 'deepseek-r1', messages: [] },
      onChunk,
      onDone,
      onError,
      { httpModule: harness.httpModule, activeRequests: new Map() },
      null, // onThinking なし
    );

    harness.emitData('{"message":{"content":"Hello"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    expect(onChunk).toHaveBeenCalledWith('Hello');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('ネイティブ thinking を受信後は <think> タグパーサーを無効化する', () => {
    const { harness, onChunk, onThinking } = makeStream();

    // ネイティブ thinking を受信
    harness.emitData('{"message":{"thinking":"native think","content":""}}\n');
    // 以降の content に <think> タグが含まれていても onChunk そのまま通す
    harness.emitData('{"message":{"content":"<think>not parsed</think>"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    expect(onThinking).toHaveBeenCalledTimes(1);
    expect(onThinking).toHaveBeenCalledWith('native think');
    expect(onChunk).toHaveBeenCalledWith('<think>not parsed</think>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// <think> タグ フォールバックパーサー
// ─────────────────────────────────────────────────────────────────────────────

describe('ollamaChatStream — <think> tag parser (fallback)', () => {
  test('<think>...</think> を分離して onThinking と onChunk に振り分ける', () => {
    const { harness, onChunk, onThinking, onDone } = makeStream();

    harness.emitData('{"message":{"content":"<think>reasoning</think>Answer"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    expect(onThinking).toHaveBeenCalledWith('reasoning');
    expect(onChunk).toHaveBeenCalledWith('Answer');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('<think> タグがチャンク境界をまたいでも正しくパースする', () => {
    const { harness, onChunk, onThinking } = makeStream();

    // タグを複数チャンクに分断
    harness.emitData('{"message":{"content":"<thi"}}\n');
    harness.emitData('{"message":{"content":"nk>rea"}}\n');
    harness.emitData('{"message":{"content":"soning</thi"}}\n');
    harness.emitData('{"message":{"content":"nk>OK"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    const thinkingText = onThinking.mock.calls.map(([t]) => t).join('');
    const chunkText = onChunk.mock.calls.map(([t]) => t).join('');
    expect(thinkingText).toBe('reasoning');
    expect(chunkText).toBe('OK');
  });

  test('<think> の前後に通常テキストがあっても正しく分離する', () => {
    const { harness, onChunk, onThinking } = makeStream();

    harness.emitData('{"message":{"content":"Before<think>think text</think>After"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    expect(onThinking).toHaveBeenCalledWith('think text');
    const chunkText = onChunk.mock.calls.map(([t]) => t).join('');
    expect(chunkText).toBe('BeforeAfter');
  });

  test('<think> タグがない場合は onThinking を呼ばずすべて onChunk に流す', () => {
    const { harness, onChunk, onThinking, onDone } = makeStream();

    harness.emitData('{"message":{"content":"Normal answer"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    expect(onThinking).not.toHaveBeenCalled();
    const emittedText = onChunk.mock.calls.map(([t]) => t).join('');
    expect(emittedText).toBe('Normal answer');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('複数の <think> ブロックをすべて検出して処理する', () => {
    const { harness, onChunk, onThinking } = makeStream();

    harness.emitData('{"message":{"content":"<think>T1</think>Mid<think>T2</think>End"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    const thinkingCalls = onThinking.mock.calls.map(([t]) => t);
    expect(thinkingCalls).toEqual(['T1', 'T2']);
    const chunkText = onChunk.mock.calls.map(([t]) => t).join('');
    expect(chunkText).toBe('MidEnd');
  });
});
