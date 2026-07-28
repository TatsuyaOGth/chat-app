'use strict';

const { loadMainWithMocks } = require('./helpers/load-main');

describe('ipc ollama:chat', () => {
  const originalTavilyKey = process.env.TAVILY_API_KEY;

  afterEach(() => {
    if (originalTavilyKey === undefined) {
      delete process.env.TAVILY_API_KEY;
    } else {
      process.env.TAVILY_API_KEY = originalTavilyKey;
    }
  });

  test('stream の chunk と done を renderer へ転送する', () => {
    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };
    const payload = {
      requestId: 'req-1',
      model: 'llama3',
      messages: [{ role: 'user', content: 'hello' }],
      system: 'helpful',
      options: { temperature: 0.7 },
    };

    mockOllamaChatStream.mockImplementation((streamPayload, onChunk, onDone) => {
      onChunk('A');
      onChunk('B');
      onDone();
    });

    mockEvents.get('ollama:chat')({ sender }, payload);

    expect(mockOllamaChatStream).toHaveBeenCalledWith(
      payload,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ activeRequests: expect.any(Map) }),
      expect.any(Function),
    );
    const chunkCalls = sender.send.mock.calls
      .filter(([channel]) => channel === 'ollama:chat:chunk')
      .map(([, data]) => data);

    expect(sender.send).toHaveBeenCalledWith('ollama:chat:progress', {
      requestId: 'req-1',
      stage: 'generating',
      message: '回答を生成中…',
    });
    expect(chunkCalls).toEqual([
      {
        requestId: 'req-1',
        content: 'A',
        done: false,
      },
      {
        requestId: 'req-1',
        content: 'B',
        done: false,
      },
      {
        requestId: 'req-1',
        content: '',
        done: true,
      },
    ]);
  });

  test('reasoningEnabled: false は ollamaChatStream へ think: false として渡す', () => {
    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };
    const payload = {
      requestId: 'req-think',
      model: 'qwen3',
      messages: [{ role: 'user', content: 'hello' }],
      reasoningEnabled: false,
    };

    mockOllamaChatStream.mockImplementation((streamPayload, onChunk, onDone) => {
      onDone();
    });

    mockEvents.get('ollama:chat')({ sender }, payload);

    expect(mockOllamaChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-think', think: false }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ activeRequests: expect.any(Map) }),
      expect.any(Function),
    );
  });

  test('stream error を renderer の error イベントへ転送する', () => {
    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };

    mockOllamaChatStream.mockImplementation((_payload, _onChunk, _onDone, onError) => {
      onError(new Error('HTTP 503: busy'));
    });

    mockEvents.get('ollama:chat')({ sender }, {
      requestId: 'req-2',
      model: 'llama3',
      messages: [],
    });

    expect(sender.send).toHaveBeenCalledWith('ollama:chat:error', {
      requestId: 'req-2',
      error: 'HTTP 503: busy',
    });
  });

  test('web search 有効時に Tavily API Key 未設定ならエラー通知して生成を開始しない', async () => {
    delete process.env.TAVILY_API_KEY;

    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };

    mockEvents.get('ollama:chat')({ sender }, {
      requestId: 'req-3',
      model: 'llama3',
      messages: [{ role: 'user', content: 'hello' }],
      webSearchEnabled: true,
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockOllamaChatStream).not.toHaveBeenCalled();
    expect(sender.send).toHaveBeenCalledWith('ollama:chat:error', {
      requestId: 'req-3',
      error: 'Tavily API Key が設定されていないため、検索つき生成を開始できません。',
    });
  });
});