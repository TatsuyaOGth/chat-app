'use strict';

const { loadMainWithMocks } = require('./helpers/load-main');

describe('ipc ollama:get-config / ollama:set-config / ollama:test-connection', () => {
  test('ollama:get-config は保存済みの baseUrl を返す', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    mockStorage.ollamaConfig.get.mockReturnValue({ baseUrl: 'http://192.168.1.50:11434' });

    const result = await mockHandles.get('ollama:get-config')();

    expect(result).toEqual({ baseUrl: 'http://192.168.1.50:11434' });
  });

  test('ollama:set-config は妥当なURLを保存する', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    mockStorage.ollamaConfig.set.mockReturnValue({ baseUrl: 'http://192.168.1.50:11434' });

    const result = await mockHandles.get('ollama:set-config')({}, 'http://192.168.1.50:11434');

    expect(mockStorage.ollamaConfig.set).toHaveBeenCalledWith('http://192.168.1.50:11434');
    expect(result).toEqual({ ok: true, baseUrl: 'http://192.168.1.50:11434' });
  });

  test('ollama:set-config は不正なURLを拒否して保存しない', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();

    const result = await mockHandles.get('ollama:set-config')({}, 'not-a-url');

    expect(mockStorage.ollamaConfig.set).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('ollama:set-config は http/https 以外のプロトコルを拒否する', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();

    const result = await mockHandles.get('ollama:set-config')({}, 'ftp://192.168.1.50:11434');

    expect(mockStorage.ollamaConfig.set).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  test('ollama:test-connection は成功時に modelCount を返す', async () => {
    const { mockHandles, mockOllamaRequest } = loadMainWithMocks();
    mockOllamaRequest.mockResolvedValue({ models: [{ name: 'llama3' }, { name: 'qwen3' }] });

    const result = await mockHandles.get('ollama:test-connection')({}, 'http://192.168.1.50:11434');

    expect(mockOllamaRequest).toHaveBeenCalledWith('GET', '/api/tags', null, expect.objectContaining({
      baseUrl: 'http://192.168.1.50:11434',
    }));
    expect(result).toEqual({ ok: true, modelCount: 2 });
  });

  test('ollama:test-connection は失敗時に error を返す', async () => {
    const { mockHandles, mockOllamaRequest } = loadMainWithMocks();
    mockOllamaRequest.mockRejectedValue(new Error('connection refused'));

    const result = await mockHandles.get('ollama:test-connection')({}, 'http://192.168.1.50:11434');

    expect(result).toEqual({ ok: false, error: 'connection refused' });
  });

  test('ollama:test-connection は baseUrl 省略時に保存済み設定を使う', async () => {
    const { mockHandles, mockOllamaRequest, mockStorage } = loadMainWithMocks();
    mockStorage.ollamaConfig.get.mockReturnValue({ baseUrl: 'http://saved-host:11434' });
    mockOllamaRequest.mockResolvedValue({ models: [] });

    await mockHandles.get('ollama:test-connection')({}, undefined);

    expect(mockOllamaRequest).toHaveBeenCalledWith('GET', '/api/tags', null, expect.objectContaining({
      baseUrl: 'http://saved-host:11434',
    }));
  });
});
