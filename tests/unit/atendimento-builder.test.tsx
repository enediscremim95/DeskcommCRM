import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  configureChannelConcurrencyAction: vi.fn(),
  createMcpAgentAction: vi.fn(),
  publishAgentAction: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/i18n/useT', () => ({ useT: () => (text: string) => text }));
vi.mock('@/app/app/ai/agents/[id]/_actions', () => actions);

import { AtendimentoBuilder } from '@/app/app/ai/atendimento/AtendimentoBuilder';
import { NAV_DESTINATIONS } from '@/lib/navigation/registry';

const channel = {
  id: '11111111-1111-4111-8111-111111111111',
  display_name: 'WhatsApp comercial',
  status: 'WORKING',
  phone_number: '+5541999999999',
};

describe('montagem do atendimento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fica acessível pela navegação principal da IA', () => {
    const destination = NAV_DESTINATIONS.find((item) => item.href === '/app/ai/atendimento');
    expect(destination).toMatchObject({ sidebar: true, minRole: 'admin' });
  });

  it('mostra as quatro perguntas e mantém a ativação bloqueada antes do teste', () => {
    render(
      <AtendimentoBuilder
        channels={[channel]}
        provider="anthropic"
        model="claude-sonnet-5"
        credentialId={null}
        defaultToolIds={[]}
      />,
    );

    expect(screen.getByText('O que este agente deve resolver e como deve falar?')).toBeVisible();
    expect(screen.getByText('O que o agente precisa saber?')).toBeVisible();
    expect(screen.getByText('Quando e em qual ritmo ele deve atender?')).toBeVisible();
    expect(screen.getByText('Quando uma pessoa deve assumir e quem será chamado?')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ligar no número' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar e preparar o teste' })).toBeDisabled();
  });

  it('não oferece salvar quando o número não está conectado', () => {
    render(
      <AtendimentoBuilder
        channels={[{ ...channel, status: 'STOPPED' }]}
        provider="anthropic"
        model="claude-sonnet-5"
        credentialId={null}
        defaultToolIds={[]}
      />,
    );
    expect(
      screen.getByText(
        'Antes de montar o atendimento, conecte um número e configure um modelo de IA com ferramentas.',
      ),
    ).toBeVisible();
  });

  it('só libera ligar no número depois de o teste real responder com sucesso', async () => {
    const user = userEvent.setup();
    actions.configureChannelConcurrencyAction.mockResolvedValue({ ok: true, data: { max_concurrent: 1 } });
    actions.createMcpAgentAction.mockResolvedValue({
      ok: true,
      data: {
        agent_id: '22222222-2222-4222-8222-222222222222',
        version_id: '33333333-3333-4333-8333-333333333333',
      },
    });
    actions.publishAgentAction.mockResolvedValue({ ok: true });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/test')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { status: 'ok', final_text: 'Como posso ajudar?' } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: { id: 'material-1' } }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AtendimentoBuilder
        channels={[channel]}
        provider="anthropic"
        model="claude-sonnet-5"
        credentialId={null}
        defaultToolIds={[]}
      />,
    );
    await user.type(
      screen.getByLabelText('Objetivo do atendimento'),
      'Tirar dúvidas e encaminhar orçamentos.',
    );
    await user.type(
      screen.getByPlaceholderText('Cole aqui produtos, serviços, regras e respostas importantes.'),
      'A empresa atende em Curitiba e vende produtos sob orçamento.',
    );
    await user.click(screen.getByRole('button', { name: 'Salvar e preparar o teste' }));

    const publish = await screen.findByRole('button', { name: 'Ligar no número' });
    expect(actions.createMcpAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          tool_ids: ['crm_apply_channel_label'],
          operator_tool_ids: ['crm_apply_channel_label'],
        }),
      }),
    );
    expect(publish).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem de teste' }));
    expect(await screen.findByText('Como posso ajudar?')).toBeVisible();
    expect(publish).toBeEnabled();

    await user.click(publish);
    expect(actions.publishAgentAction).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    );
    vi.unstubAllGlobals();
  });
});
