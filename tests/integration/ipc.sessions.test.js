'use strict';

const { loadMainWithMocks } = require('./helpers/load-main');

describe('ipc sessions handlers', () => {
  test('sessions:list は storage.sessions.list を返す', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    mockStorage.sessions.list.mockReturnValue([{ id: 's1' }]);

    const result = await mockHandles.get('sessions:list')();

    expect(mockStorage.sessions.list).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: 's1' }]);
  });

  test('sessions:get は id を渡して storage.sessions.get を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    mockStorage.sessions.get.mockReturnValue({ id: 's2' });

    const result = await mockHandles.get('sessions:get')({}, 's2');

    expect(mockStorage.sessions.get).toHaveBeenCalledWith('s2');
    expect(result).toEqual({ id: 's2' });
  });

  test('sessions:create は data を渡して storage.sessions.create を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    const data = { title: 'Chat' };
    mockStorage.sessions.create.mockReturnValue({ id: 's3', title: 'Chat' });

    const result = await mockHandles.get('sessions:create')({}, data);

    expect(mockStorage.sessions.create).toHaveBeenCalledWith(data);
    expect(result).toEqual({ id: 's3', title: 'Chat' });
  });

  test('sessions:update は id と patch を渡して storage.sessions.update を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    const patch = { title: 'Renamed' };
    mockStorage.sessions.update.mockReturnValue({ id: 's4', title: 'Renamed' });

    const result = await mockHandles.get('sessions:update')({}, 's4', patch);

    expect(mockStorage.sessions.update).toHaveBeenCalledWith('s4', patch);
    expect(result).toEqual({ id: 's4', title: 'Renamed' });
  });

  test('sessions:append-message は id と message を渡して storage.sessions.appendMessage を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    const message = { role: 'assistant', content: 'hello' };
    mockStorage.sessions.appendMessage.mockReturnValue({ id: 's5', messages: [message] });

    const result = await mockHandles.get('sessions:append-message')({}, 's5', message);

    expect(mockStorage.sessions.appendMessage).toHaveBeenCalledWith('s5', message);
    expect(result).toEqual({ id: 's5', messages: [message] });
  });

  test('sessions:delete は id を渡して storage.sessions.delete を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    mockStorage.sessions.delete.mockReturnValue(true);

    const result = await mockHandles.get('sessions:delete')({}, 's6');

    expect(mockStorage.sessions.delete).toHaveBeenCalledWith('s6');
    expect(result).toBe(true);
  });
});