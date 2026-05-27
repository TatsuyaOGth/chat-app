'use strict';

const { loadMainWithMocks } = require('./helpers/load-main');

describe('ipc presets handlers', () => {
  test('presets:list は storage.presets.list を返す', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    mockStorage.presets.list.mockReturnValue([{ id: 'p1' }]);

    const result = await mockHandles.get('presets:list')();

    expect(mockStorage.presets.list).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: 'p1' }]);
  });

  test('presets:get は id を渡して storage.presets.get を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    mockStorage.presets.get.mockReturnValue({ id: 'p2' });

    const result = await mockHandles.get('presets:get')({}, 'p2');

    expect(mockStorage.presets.get).toHaveBeenCalledWith('p2');
    expect(result).toEqual({ id: 'p2' });
  });

  test('presets:create は data を渡して storage.presets.create を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    const data = { name: 'Default', params: { temperature: 0.7 } };
    mockStorage.presets.create.mockReturnValue({ id: 'p3', ...data });

    const result = await mockHandles.get('presets:create')({}, data);

    expect(mockStorage.presets.create).toHaveBeenCalledWith(data);
    expect(result).toEqual({ id: 'p3', ...data });
  });

  test('presets:update は id と patch を渡して storage.presets.update を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    const patch = { name: 'Updated' };
    mockStorage.presets.update.mockReturnValue({ id: 'p4', name: 'Updated' });

    const result = await mockHandles.get('presets:update')({}, 'p4', patch);

    expect(mockStorage.presets.update).toHaveBeenCalledWith('p4', patch);
    expect(result).toEqual({ id: 'p4', name: 'Updated' });
  });

  test('presets:delete は id を渡して storage.presets.delete を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    mockStorage.presets.delete.mockReturnValue(true);

    const result = await mockHandles.get('presets:delete')({}, 'p5');

    expect(mockStorage.presets.delete).toHaveBeenCalledWith('p5');
    expect(result).toBe(true);
  });

  test('presets:reorder は orderedIds を渡して storage.presets.reorder を呼ぶ', async () => {
    const { mockHandles, mockStorage } = loadMainWithMocks();
    const orderedIds = ['p2', 'p1'];
    mockStorage.presets.reorder.mockReturnValue([{ id: 'p2' }, { id: 'p1' }]);

    const result = await mockHandles.get('presets:reorder')({}, orderedIds);

    expect(mockStorage.presets.reorder).toHaveBeenCalledWith(orderedIds);
    expect(result).toEqual([{ id: 'p2' }, { id: 'p1' }]);
  });
});