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
  req.destroy = jest.fn(() => {
    req.emit('error', new Error('socket closed'));
  });
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
    emitData(chunk) {
      response.emit('data', chunk);
    },
    emitEnd() {
      response.emit('end');
    },
  };
}

describe('ollamaChatStream', () => {
  test('3 チャンクのストリームを処理して done を 1 回だけ返す', () => {
    const harness = createHttpHarness();
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    ollamaChatStream(
      {
        requestId: 'req-1',
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      },
      onChunk,
      onDone,
      onError,
      { httpModule: harness.httpModule, activeRequests: new Map() },
    );

    harness.emitData('{"message":{"content":"A"}}\n');
    harness.emitData('{"message":{"content":"B"}}\n');
    harness.emitData('{"done":true}\n');
    harness.emitEnd();

    expect(onChunk).toHaveBeenNthCalledWith(1, 'A');
    expect(onChunk).toHaveBeenNthCalledWith(2, 'B');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('不正 JSON が混在しても残りのチャンク処理を継続する', () => {
    const harness = createHttpHarness();
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    ollamaChatStream(
      {
        requestId: 'req-2',
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      },
      onChunk,
      onDone,
      onError,
      { httpModule: harness.httpModule, activeRequests: new Map() },
    );

    harness.emitData('not-json\n');
    harness.emitData('{"message":{"content":"after"}}\n');
    harness.emitEnd();

    expect(onChunk).toHaveBeenCalledWith('after');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('HTTP エラー時は onError に遷移して onDone しない', () => {
    const harness = createHttpHarness(503);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    ollamaChatStream(
      {
        requestId: 'req-3',
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      },
      onChunk,
      onDone,
      onError,
      { httpModule: harness.httpModule, activeRequests: new Map() },
    );

    harness.emitData('{"error":"busy"}');
    harness.emitEnd();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'HTTP 503: busy' }));
    expect(onDone).not.toHaveBeenCalled();
    expect(onChunk).not.toHaveBeenCalled();
  });

  test('無通信 timeout で onError する', () => {
    const harness = createHttpHarness();
    const onError = jest.fn();
    let timeoutCallback;
    const setTimeoutFn = jest.fn((callback) => {
      timeoutCallback = callback;
      return { timeoutId: 1 };
    });
    const clearTimeoutFn = jest.fn();

    ollamaChatStream(
      {
        requestId: 'req-4',
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      },
      jest.fn(),
      jest.fn(),
      onError,
      {
        httpModule: harness.httpModule,
        activeRequests: new Map(),
        inactivityTimeoutMs: 1,
        setTimeoutFn,
        clearTimeoutFn,
      },
    );

    timeoutCallback();

    expect(harness.req.destroy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: '応答タイムアウト: サーバーからの応答が途絶えました' }));
  });

  test('activeRequests の abort で in-flight request を中断できる', () => {
    const harness = createHttpHarness();
    const activeRequests = new Map();
    const onDone = jest.fn();
    const onError = jest.fn();

    ollamaChatStream(
      {
        requestId: 'req-5',
        model: 'llama3',
        messages: [{ role: 'user', content: 'hello' }],
      },
      jest.fn(),
      onDone,
      onError,
      { httpModule: harness.httpModule, activeRequests },
    );

    expect(activeRequests.has('req-5')).toBe(true);
    expect(activeRequests.get('req-5')()).toBe(true);
    expect(harness.req.destroy).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});