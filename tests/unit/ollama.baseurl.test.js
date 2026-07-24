'use strict';

const { EventEmitter } = require('node:events');

const { ollamaRequest, resolveOllamaConnection } = require('../../src/ollama');

function createHttpHarness(statusCode = 200, responseBody = '{}') {
  let response = null;
  let responseCallback = null;

  const req = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn(() => {
    response = new EventEmitter();
    response.statusCode = statusCode;
    responseCallback(response);
    response.emit('data', responseBody);
    response.emit('end');
  });
  req.destroy = jest.fn();
  req.setTimeout = jest.fn();

  const httpModule = {
    request: jest.fn((options, callback) => {
      responseCallback = callback;
      return req;
    }),
  };

  return { httpModule, req };
}

describe('resolveOllamaConnection', () => {
  test('baseUrl 省略時は localhost:11434 にフォールバックする', () => {
    const conn = resolveOllamaConnection(undefined);
    expect(conn.hostname).toBe('localhost');
    expect(conn.port).toBe(11434);
    expect(conn.pathPrefix).toBe('');
  });

  test('LAN上のホストとポートを解決する', () => {
    const conn = resolveOllamaConnection('http://192.168.1.50:11434');
    expect(conn.hostname).toBe('192.168.1.50');
    expect(conn.port).toBe(11434);
  });

  test('ポート省略時は http は 80 / https は 443 にフォールバックする', () => {
    expect(resolveOllamaConnection('http://example.com').port).toBe(80);
    expect(resolveOllamaConnection('https://example.com').port).toBe(443);
  });

  test('パス付きURL（リバースプロキシ）は pathPrefix として保持する', () => {
    const conn = resolveOllamaConnection('http://example.com/ollama');
    expect(conn.pathPrefix).toBe('/ollama');
  });

  test('http/https 以外のプロトコルはエラーになる', () => {
    expect(() => resolveOllamaConnection('ftp://example.com')).toThrow();
  });

  test('不正なURL文字列はエラーになる', () => {
    expect(() => resolveOllamaConnection('not-a-url')).toThrow();
  });
});

describe('ollamaRequest with custom baseUrl', () => {
  test('deps.baseUrl で指定したホスト/ポート/パスへリクエストする', async () => {
    const harness = createHttpHarness(200, '{"ok":true}');

    const result = await ollamaRequest('GET', '/api/tags', null, {
      httpModule: harness.httpModule,
      baseUrl: 'http://192.168.1.50:11434',
    });

    expect(harness.httpModule.request).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: '192.168.1.50',
        port: 11434,
        path: '/api/tags',
      }),
      expect.any(Function),
    );
    expect(result).toEqual({ ok: true });
  });

  test('パスプレフィックス付きの baseUrl はパスに前置される', async () => {
    const harness = createHttpHarness(200, '{}');

    await ollamaRequest('GET', '/api/tags', null, {
      httpModule: harness.httpModule,
      baseUrl: 'http://example.com/ollama',
    });

    expect(harness.httpModule.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/ollama/api/tags' }),
      expect.any(Function),
    );
  });
});
