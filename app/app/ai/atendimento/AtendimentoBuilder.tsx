'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircle, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/hooks/i18n/useT';
import type { SelectableChannel } from '@/lib/channels/selectable';
import {
  configureChannelConcurrencyAction,
  createMcpAgentAction,
  publishAgentAction,
} from '../agents/[id]/_actions';

type KnowledgeMode = 'texto' | 'arquivo' | 'site';

interface Props {
  channels: SelectableChannel[];
  provider: string | null;
  model: string | null;
  credentialId: string | null;
  defaultToolIds: string[];
}

interface CreatedState { agentId: string; versionId: string }

function Section(props: { number: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {props.number}
          </span>
          <div>
            <CardTitle>{props.title}</CardTitle>
            <CardDescription className="mt-1">{props.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{props.children}</CardContent>
    </Card>
  );
}

export function AtendimentoBuilder({ channels, provider, model, credentialId, defaultToolIds }: Props) {
  const t = useT();
  const [name, setName] = useState(() => t('Atendimento'));
  const [purpose, setPurpose] = useState('');
  const [tone, setTone] = useState(() => t('Claro, acolhedor e objetivo'));
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>('texto');
  const [knowledge, setKnowledge] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [businessHours, setBusinessHours] = useState(true);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('18:00');
  const [oneAtATime, setOneAtATime] = useState(true);
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [handoff, setHandoff] = useState(() =>
    t('quando a pessoa pedir um humano, estiver irritada ou o agente não souber responder'),
  );
  const [responsible, setResponsible] = useState(() => t('equipe de atendimento'));
  const [created, setCreated] = useState<CreatedState | null>(null);
  const [testMessage, setTestMessage] = useState(() => t('Olá, preciso de ajuda.'));
  const [testAnswer, setTestAnswer] = useState('');
  const [tested, setTested] = useState(false);
  const [pending, setPending] = useState<'save' | 'test' | 'publish' | null>(null);

  const channel = channels.find((candidate) => candidate.status === 'WORKING') ?? null;
  const ready = Boolean(channel && provider && model);
  const knowledgeReady = knowledgeMode === 'arquivo' ? file !== null : knowledge.trim().length > 0;
  const canSave = ready && purpose.trim().length > 0 && tone.trim().length > 0 && knowledgeReady && handoff.trim().length > 0 && responsible.trim().length > 0;
  const advancedHref = created ? `/app/ai/agents/${created.agentId}` : '/app/ai/agents/new';

  const prompt = useMemo(
    () => [
      `Você é o agente de atendimento ${name.trim()}.`,
      `Objetivo: ${purpose.trim()}.`,
      `Tom de voz: ${tone.trim()}.`,
      'Responda em português do Brasil, com clareza e sem inventar informações.',
      `Passe para uma pessoa ${handoff.trim()}. O responsável é ${responsible.trim()}.`,
      'Ao concluir um atendimento, use a ação de etiqueta do canal quando houver uma etiqueta existente que represente o desfecho.',
    ].join('\n'),
    [handoff, name, purpose, responsible, tone],
  );

  async function createKnowledge(): Promise<string> {
    let response: Response;
    if (knowledgeMode === 'arquivo') {
      const form = new FormData();
      form.set('name', `${name.trim()} - material`);
      form.set('file', file!);
      response = await fetch('/api/v1/ai/knowledge/sources/upload', { method: 'POST', body: form });
    } else {
      response = await fetch('/api/v1/ai/knowledge/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: 'documento',
          name: `${name.trim()} - material`,
          ...(knowledgeMode === 'site' ? { source_url: knowledge.trim() } : { markdown_blob: knowledge.trim() }),
        }),
      });
    }
    const body = (await response.json()) as { data?: { id?: string }; error?: { message?: string } };
    if (!response.ok || !body.data?.id) throw new Error(body.error?.message ?? t('Falha ao guardar o material.'));
    return body.data.id;
  }

  async function handleSave() {
    if (!canSave || !channel || !provider || !model) return;
    setPending('save');
    try {
      const knowledgeId = await createKnowledge();
      const concurrency = await configureChannelConcurrencyAction(
        channel.id,
        oneAtATime ? 1 : maxConcurrent,
      );
      if (!concurrency.ok) throw new Error(concurrency.message ?? concurrency.error);
      const result = await createMcpAgentAction({
        name: name.trim(),
        description: purpose.trim(),
        priority: 0,
        version: {
          system_prompt: prompt,
          provider,
          model,
          credential_id: credentialId,
          tool_ids: [...new Set([...defaultToolIds, 'crm_apply_channel_label'])],
          trigger_config: {
            events: ['message'],
            filters: {
              ignore_groups: true,
              ignore_self: true,
              keyword_regex: null,
              business_hours: businessHours
                ? { timezone: 'America/Sao_Paulo', start, end, weekdays: [1, 2, 3, 4, 5] }
                : null,
            },
            concurrency: 'one_per_conversation',
          },
          channel_session_id: channel.id,
          max_steps: 10,
          token_budget: 50_000,
          cost_budget_cents: 50,
          history_message_window: 20,
          history_token_window: 8_000,
          handoff_keywords: ['falar com humano', 'atendente', 'pessoa real'],
          handoff_tool_enabled: true,
          cases_enabled: true,
          split_messages: true,
          split_max_chars: 600,
          followup: { enabled: false, flow_pointer_ids: [] },
          operator_enabled: true,
          operator_model: null,
          operator_tool_ids: ['crm_apply_channel_label'],
          pipeline_ids: [],
          knowledge_source_ids: [knowledgeId],
        },
      });
      if (!result.ok) throw new Error(result.message ?? result.error);
      if (!result.data) throw new Error(t('Não foi possível salvar o atendimento.'));
      setCreated({ agentId: result.data.agent_id, versionId: result.data.version_id });
      toast.success(t('Rascunho salvo. Agora converse com o agente antes de ligar no número.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível salvar o atendimento.'));
    } finally {
      setPending(null);
    }
  }

  async function handleTest() {
    if (!created || !testMessage.trim()) return;
    setPending('test');
    setTested(false);
    try {
      const response = await fetch(`/api/v1/ai/agents/${created.agentId}/versions/${created.versionId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_message: testMessage.trim() }),
      });
      const body = (await response.json()) as { data?: { status?: string; final_text?: string }; error?: { message?: string } };
      if (!response.ok || body.data?.status !== 'ok') throw new Error(body.error?.message ?? t('O teste não terminou com sucesso.'));
      setTestAnswer(body.data.final_text ?? '');
      setTested(true);
      toast.success(t('Teste aprovado. O número já pode ser ligado.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível executar o teste.'));
    } finally {
      setPending(null);
    }
  }

  async function handlePublish() {
    if (!created || !tested) return;
    setPending('publish');
    try {
      const result = await publishAgentAction(created.agentId, created.versionId);
      if (!result.ok) throw new Error(result.message ?? result.error);
      toast.success(t('Atendimento ligado no número.'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível ligar o atendimento.'));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('Montar atendimento')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('Responda quatro perguntas, teste a conversa e só então ligue o agente no número.')}</p>
        </div>
        <Button variant="outline" asChild><Link href={advancedHref}><Settings2 className="mr-2 h-4 w-4" />{t('Ajustes avançados')}</Link></Button>
      </div>

      {!ready && (
        <Card className="border-amber-500/50"><CardContent className="pt-6 text-sm">{t('Antes de montar o atendimento, conecte um número e configure um modelo de IA com ferramentas.')}</CardContent></Card>
      )}

      <Section number={1} title={t('O que este agente deve resolver e como deve falar?')} description={t('Defina o objetivo e o jeito de conversar com seus clientes.')}>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="agent-name">{t('Nome do agente')}</Label><Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="tone">{t('Tom de voz')}</Label><Input id="tone" value={tone} onChange={(e) => setTone(e.target.value)} /></div></div>
        <div className="space-y-2"><Label htmlFor="purpose">{t('Objetivo do atendimento')}</Label><Textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t('Exemplo: tirar dúvidas, qualificar o cliente e encaminhar pedidos de orçamento.')} /></div>
      </Section>

      <Section number={2} title={t('O que o agente precisa saber?')} description={t('Escolha uma fonte. Ela será gravada no acervo existente da organização.')}>
        <div className="flex flex-wrap gap-2">{(['texto', 'arquivo', 'site'] as KnowledgeMode[]).map((mode) => <Button key={mode} type="button" variant={knowledgeMode === mode ? 'default' : 'outline'} onClick={() => setKnowledgeMode(mode)}>{t(mode === 'texto' ? 'Colar texto' : mode === 'arquivo' ? 'Enviar arquivo' : 'Ler um site')}</Button>)}</div>
        {knowledgeMode === 'arquivo' ? <Input type="file" accept=".pdf,.md,.txt,text/plain,text/markdown,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /> : knowledgeMode === 'site' ? <Input value={knowledge} onChange={(e) => setKnowledge(e.target.value)} placeholder="https://" /> : <Textarea value={knowledge} onChange={(e) => setKnowledge(e.target.value)} rows={7} placeholder={t('Cole aqui produtos, serviços, regras e respostas importantes.')} />}
      </Section>

      <Section number={3} title={t('Quando e em qual ritmo ele deve atender?')} description={t('O ritmo humano já vem ligado. O limite vale para atendimento e follow-up juntos.')}>
        <div className="flex items-center justify-between gap-4"><div><Label>{t('Atender apenas no horário comercial')}</Label></div><Switch checked={businessHours} onCheckedChange={setBusinessHours} /></div>
        {businessHours && <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="start">{t('Abre às')}</Label><Input id="start" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="end">{t('Fecha às')}</Label><Input id="end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div></div>}
        <div className="flex items-center justify-between gap-4"><div><Label>{t('Ritmo humano')}</Label><p className="text-xs text-muted-foreground">{t('Digitando, espera proporcional e respostas em mensagens curtas.')}</p></div><Switch checked disabled /></div>
        <div className="flex items-center justify-between gap-4"><div><Label>{t('Falar com uma pessoa por vez')}</Label><p className="text-xs text-muted-foreground">{t('Impede que o mesmo canal responda duas conversas ao mesmo tempo.')}</p></div><Switch checked={oneAtATime} onCheckedChange={setOneAtATime} /></div>
        {!oneAtATime && <div className="space-y-2"><Label htmlFor="max-concurrent">{t('Conversas simultâneas por canal')}</Label><Input id="max-concurrent" type="number" min={2} max={20} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Math.max(2, Math.min(20, Number(e.target.value))))} /></div>}
      </Section>

      <Section number={4} title={t('Quando uma pessoa deve assumir e quem será chamado?')} description={t('O agente abre o caso e interrompe a automação quando encontrar essas situações.')}>
        <div className="space-y-2"><Label htmlFor="handoff">{t('Passar para uma pessoa quando')}</Label><Textarea id="handoff" value={handoff} onChange={(e) => setHandoff(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="responsible">{t('Quem assume')}</Label><Input id="responsible" value={responsible} onChange={(e) => setResponsible(e.target.value)} /></div>
      </Section>

      {!created ? <Button size="lg" disabled={!canSave || pending !== null} onClick={handleSave}>{pending === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('Salvar e preparar o teste')}</Button> : (
        <Card className="border-primary/30"><CardHeader><CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5" />{t('Conversar com o agente')}</CardTitle><CardDescription>{t('Este teste usa o motor real, mas não envia mensagem para o número.')}</CardDescription></CardHeader><CardContent className="space-y-4"><Textarea value={testMessage} onChange={(e) => { setTestMessage(e.target.value); setTested(false); }} /><Button variant="outline" disabled={pending !== null || !testMessage.trim()} onClick={handleTest}>{pending === 'test' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('Enviar mensagem de teste')}</Button>{testAnswer && <div className="rounded-lg border bg-muted/40 p-4 text-sm whitespace-pre-wrap">{testAnswer}</div>}<Button size="lg" disabled={!tested || pending !== null} onClick={handlePublish}>{pending === 'publish' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{t('Ligar no número')}</Button>{!tested && <p className="text-xs text-muted-foreground">{t('O botão só libera depois de uma conversa de teste concluída com sucesso.')}</p>}</CardContent></Card>
      )}
    </div>
  );
}
