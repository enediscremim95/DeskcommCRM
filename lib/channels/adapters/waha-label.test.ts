import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  listLabels: vi.fn(),
  getChatLabels: vi.fn(),
  setChatLabels: vi.fn(),
}));

vi.mock('@/lib/waha/client', () => ({ getWahaClient: () => client }));

import { wahaAdapter } from './waha';

describe('etiqueta da conversa no WAHA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encontra a etiqueta pelo nome e preserva as etiquetas existentes', async () => {
    client.listLabels.mockResolvedValue([
      { id: 'label-atual', name: 'Cliente' },
      { id: 'label-desejada', name: 'Orçamento enviado' },
    ]);
    client.getChatLabels.mockResolvedValue([{ id: 'label-atual', name: 'Cliente' }]);
    client.setChatLabels.mockResolvedValue(undefined);

    await expect(
      wahaAdapter.addChatLabel?.({
        organizationId: '11111111-1111-4111-8111-111111111111',
        sessionRef: 'sessao',
        recipient: '5511999999999@c.us',
        labelName: 'orçamento ENVIADO',
      }),
    ).resolves.toBe('applied');
    expect(client.setChatLabels).toHaveBeenCalledWith(
      'sessao',
      '5511999999999@c.us',
      ['label-atual', 'label-desejada'],
    );
  });

  it('não inventa etiqueta que ainda não existe no WhatsApp', async () => {
    client.listLabels.mockResolvedValue([{ id: 'outra', name: 'Cliente' }]);
    await expect(
      wahaAdapter.addChatLabel?.({
        organizationId: '11111111-1111-4111-8111-111111111111',
        sessionRef: 'sessao',
        recipient: '5511999999999@c.us',
        labelName: 'Inexistente',
      }),
    ).resolves.toBe('label_not_found');
    expect(client.setChatLabels).not.toHaveBeenCalled();
  });
});
