'use strict';

const { buildChatBody } = require('../../src/ollama');

describe('buildChatBody', () => {
  test('system が空のとき先頭に system message を追加しない', () => {
    const body = buildChatBody({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hello' }],
      system: '   ',
      options: null,
    });

    expect(body).toEqual({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      think: true,
    });
  });

  test('system があると先頭に注入し null と undefined の option を除去する', () => {
    const body = buildChatBody({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hello' }],
      system: 'be helpful',
      options: {
        temperature: 0.7,
        top_p: null,
        seed: undefined,
        num_predict: 256,
      },
    });

    expect(body).toEqual({
      model: 'llama3',
      messages: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'hello' },
      ],
      stream: true,
      think: true,
      options: {
        temperature: 0.7,
        num_predict: 256,
      },
    });
  });

  test('think: false を明示すると推論を無効化する', () => {
    const body = buildChatBody({
      model: 'qwen3',
      messages: [{ role: 'user', content: 'hello' }],
      system: '',
      options: null,
      think: false,
    });

    expect(body).toEqual({
      model: 'qwen3',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      think: false,
    });
  });
});