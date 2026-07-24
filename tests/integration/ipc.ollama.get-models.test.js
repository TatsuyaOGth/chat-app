'use strict';

const { loadMainWithMocks } = require('./helpers/load-main');

describe('ipc ollama:get-models', () => {
  test('モデル一覧を名前配列へ正規化して返す', async () => {
    const { mockHandles, mockOllamaRequest } = loadMainWithMocks();
    mockOllamaRequest.mockResolvedValue({
      models: [
        { name: 'llama3' },
        { name: 'qwen3:latest' },
      ],
    });

    const result = await mockHandles.get('ollama:get-models')();

    expect(mockOllamaRequest).toHaveBeenCalledWith('GET', '/api/tags', null, { baseUrl: 'http://localhost:11434' });
    expect(result).toEqual({ models: ['llama3', 'qwen3:latest'] });
  });

  test('取得失敗時は空配列と error を返す', async () => {
    const { mockHandles, mockOllamaRequest } = loadMainWithMocks();
    mockOllamaRequest.mockRejectedValue(new Error('connection refused'));

    const result = await mockHandles.get('ollama:get-models')();

    expect(result).toEqual({ models: [], error: 'connection refused' });
  });
});