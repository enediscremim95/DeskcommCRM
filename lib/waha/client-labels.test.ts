import { afterEach, describe, expect, it, vi } from 'vitest';

import { WahaClient } from './client';

describe('contrato HTTP de etiquetas do WAHA', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lê etiquetas e envia a lista completa ao atualizar a conversa', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'a', name: 'Cliente' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'a', name: 'Cliente' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new WahaClient('https://waha.example', 'segredo-de-teste');

    await expect(client.listLabels('sessão principal')).resolves.toEqual([
      { id: 'a', name: 'Cliente' },
    ]);
    await expect(
      client.getChatLabels('sessão principal', '5511999999999@c.us'),
    ).resolves.toEqual([{ id: 'a', name: 'Cliente' }]);
    await client.setChatLabels('sessão principal', '5511999999999@c.us', ['a', 'b']);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://waha.example/api/sess%C3%A3o%20principal/labels',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://waha.example/api/sess%C3%A3o%20principal/labels/chats/5511999999999%40c.us/',
    );
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ labels: [{ id: 'a' }, { id: 'b' }] }),
      }),
    );
  });
});
