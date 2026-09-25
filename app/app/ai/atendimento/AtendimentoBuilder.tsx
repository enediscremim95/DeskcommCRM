"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Handle, Position, ReactFlowProvider, useEdgesState, useNodesState, type Edge, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/i18n/useT";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";
import type { SelectableChannel } from "@/lib/channels/selectable";
import { cn } from "@/lib/utils";
import { BookOpen, Brain, FlowArrow, Lock, Plugs, PuzzlePiece, ShieldCheck, UsersThree } from "@/lib/ui/icons";
import {
  estadoDaVersao,
  novoAtendimentoDoModelo,
  TEMPLATE_SUMMARIES,
  travasDoEstado,
  type AtendimentoDraftState,
  type AtendimentoNodeId,
  type TravaDoAtendimento,
  type TravaId,
} from "@/lib/ai/atendimento/flow";
import { FlowBuilderShell } from "../followups/[id]/_components/FlowBuilder";
import { FlowCanvasSurface } from "../followups/[id]/_components/FlowCanvas";
import { NodePalette } from "../followups/[id]/_components/NodePalette";
import { NodeConfigPanel } from "../followups/[id]/_components/NodeConfigPanel";
import { EdgeConfigPanel } from "../followups/[id]/_components/EdgeConfigPanel";
import { PublishBar } from "../followups/[id]/_components/PublishBar";
import { createMcpAgentAction, discardMcpDraftAction, publishAgentAction, revertToVersionAction } from "../agents/[id]/_actions";
import { proposeAttendanceInstructionAction, saveAtendimentoDraftAction } from "./_actions";

interface AgentSummary {
  id: string;
  name: string;
  description: string | null;
  published_version_id: string | null;
}

interface FollowupOption { id: string; name: string }

interface Props {
  channels: SelectableChannel[];
  provider: string | null;
  model: string | null;
  credentialId: string | null;
  defaultToolIds: string[];
  agent: AgentSummary | null;
  versions: AgentVersionRow[];
  dailyMessageLimit: number | null;
  followupFlows: FollowupOption[];
}

type AttendanceNodeData = { label: string; subtitle: string; icon: AtendimentoNodeId; changed?: boolean };
type AttendanceNode = Node<AttendanceNodeData, "attendance">;

const NODE_META = {
  entrada: { label: "Quando chega mensagem", icon: Plugs, chip: "bg-info-bg text-info-fg", border: "border-l-info" },
  agente: { label: "Quem atende", icon: Brain, chip: "bg-accent-soft text-accent", border: "border-l-accent-500" },
  conhecimento: { label: "O que ele sabe", icon: BookOpen, chip: "bg-success-bg text-success-fg", border: "border-l-success" },
  skills: { label: "O que ele pode fazer", icon: PuzzlePiece, chip: "bg-warning-bg text-warning-fg", border: "border-l-warning" },
  handoff: { label: "Quando passa para humano", icon: UsersThree, chip: "bg-error-bg text-error-fg", border: "border-l-error" },
  followup: { label: "Se esfriar", icon: FlowArrow, chip: "bg-info-bg text-info-fg", border: "border-l-info" },
  limites: { label: "Limites e travas", icon: ShieldCheck, chip: "bg-accent text-accent-foreground", border: "border-l-accent-700" },
} as const;

const NODE_POSITIONS: Record<AtendimentoNodeId, { x: number; y: number }> = {
  entrada: { x: 40, y: 70 }, agente: { x: 330, y: 70 }, conhecimento: { x: 620, y: 0 },
  skills: { x: 620, y: 150 }, handoff: { x: 910, y: 0 }, followup: { x: 910, y: 150 }, limites: { x: 1200, y: 70 },
};
const NODE_ORDER = Object.keys(NODE_POSITIONS) as AtendimentoNodeId[];
const EDGE_PAIRS: Array<[string, string]> = [
  ["entrada", "agente"], ["agente", "conhecimento"], ["agente", "skills"],
  ["conhecimento", "handoff"], ["skills", "followup"], ["handoff", "limites"], ["followup", "limites"],
];
const EDGES: Edge[] = EDGE_PAIRS.map(([source, target], index) => ({ id: `at-${index}`, source, target, type: "smoothstep" }));

function AttendanceNodeCard({ id, data, selected }: NodeProps<AttendanceNode>) {
  const t = useT();
  const meta = NODE_META[data.icon];
  const Icon = meta.icon;
  return (
    <div className={cn("w-60 rounded-md border border-l-4 border-border bg-surface shadow-sm", meta.border, selected && "ring-2 ring-accent-500", data.changed && "ring-2 ring-warning ring-offset-2 ring-offset-bg")} data-testid={`attendance-node-${id}`}>
      {id !== "entrada" && <Handle type="target" position={Position.Left} style={{ width: 9, height: 9 }} />}
      <div className="flex items-start gap-2.5 px-3 py-3">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", meta.chip)}><Icon size={15} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-text">{t(data.label)}</p>{data.changed && <Badge variant="warning">{t("Mudou")}</Badge>}</div>
          <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{t(data.subtitle)}</p>
        </div>
      </div>
      {id !== "limites" && <Handle type="source" position={Position.Right} style={{ width: 9, height: 9 }} />}
    </div>
  );
}
const nodeTypes: NodeTypes = { attendance: AttendanceNodeCard };

function changedNodes(summary: string[]): Set<AtendimentoNodeId> {
  const changed = new Set<AtendimentoNodeId>();
  for (const raw of summary) {
    const item = raw.toLowerCase();
    if (item.includes("skill")) changed.add("skills");
    if (item.includes("conhecimento") || item.includes("material")) changed.add("conhecimento");
    if (item.includes("humano") || item.includes("handoff")) changed.add("handoff");
    if (item.includes("horário") || item.includes("ritmo") || item.includes("limite") || item.includes("canal")) changed.add("limites");
    if (item.includes("follow")) changed.add("followup");
    if (changed.size === 0 || item.includes("prompt") || item.includes("diretriz")) changed.add("agente");
  }
  return changed;
}

function subtitleFor(id: AtendimentoNodeId, state: AtendimentoDraftState, version: AgentVersionRow | null, t: (text: string) => string): string {
  if (id === "entrada") return state.businessHoursEnabled ? `${state.startHour}h ${t("até")} ${state.endHour}h` : t("A qualquer hora");
  if (id === "agente") return `${state.name}: ${state.objective || t("objetivo a definir")}`;
  if (id === "conhecimento") return `${version?.knowledge_source_ids.length ?? 0} ${t("materiais ligados")}`;
  if (id === "skills") return `${(version?.tool_ids.length ?? 0) + (version?.skill_names?.length ?? 0)} ${t("capacidades ligadas")}`;
  if (id === "handoff") return state.handoffEnabled ? t("Abre caso e entrega para uma pessoa") : t("Desligado");
  if (id === "followup") return state.followupEnabled ? `${state.followupFlowIds.length} ${t("fluxos ligados")}` : t("Sem retomada automática");
  return `${travasDoEstado(state).filter((item) => item.enabled).length} ${t("de 7 proteções ligadas")}`;
}

export function AtendimentoBuilder(props: Props) {
  const t = useT();
  const router = useRouter();
  const initialVersion = props.versions.find((v) => v.status === "draft") ?? props.versions.find((v) => v.id === props.agent?.published_version_id) ?? props.versions[0] ?? null;
  const [version] = useState<AgentVersionRow | null>(initialVersion);
  const [agentId, setAgentId] = useState<string | null>(props.agent?.id ?? null);
  const [versionId, setVersionId] = useState<string | null>(initialVersion?.id ?? null);
  const [state, setState] = useState<AtendimentoDraftState>(() => initialVersion && props.agent ? estadoDaVersao(initialVersion, props.agent, props.dailyMessageLimit) : novoAtendimentoDoModelo("servicos"));
  const [savedState, setSavedState] = useState(state);
  const [newlyDisabled, setNewlyDisabled] = useState<TravaId[]>([]);
  const [confirmDisable, setConfirmDisable] = useState<TravaDoAtendimento | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<AtendimentoNodeId | null>("agente");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [mcpChanges, setMcpChanges] = useState<string[]>(initialVersion?.provisioning_origin === "mcp" ? initialVersion.mcp_change_summary ?? [] : []);
  const [pending, setPending] = useState<"save" | "publish" | "discard" | "rollback" | "propose" | null>(null);
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [isDesktop, setIsDesktop] = useState(true);
  const channel = props.channels.find((candidate) => candidate.status === "WORKING") ?? props.channels[0] ?? null;
  const changed = useMemo(() => changedNodes(mcpChanges), [mcpChanges]);
  const dirty = JSON.stringify(state) !== JSON.stringify(savedState) || mcpChanges.length > 0;

  const makeNodes = (): AttendanceNode[] => NODE_ORDER.map((id) => ({ id, type: "attendance", position: NODE_POSITIONS[id], draggable: isDesktop, data: { label: NODE_META[id].label, subtitle: subtitleFor(id, state, version, t), icon: id, changed: changed.has(id) } }));
  const [nodes, setNodes, onNodesChange] = useNodesState<AttendanceNode>(makeNodes());
  const [edges, , onEdgesChange] = useEdgesState(EDGES);
  useEffect(() => { setNodes((current) => current.map((node) => ({ ...node, draggable: isDesktop, data: { ...node.data, subtitle: subtitleFor(node.id as AtendimentoNodeId, state, version, t), changed: changed.has(node.id as AtendimentoNodeId) } }))); }, [state, version, changed, isDesktop, setNodes, t]);
  useEffect(() => { const media = window.matchMedia("(min-width: 1024px)"); const sync = () => setIsDesktop(media.matches); sync(); media.addEventListener("change", sync); return () => media.removeEventListener("change", sync); }, []);

  const ready = Boolean(channel && props.provider && props.model);
  const setField = <K extends keyof AtendimentoDraftState>(key: K, value: AtendimentoDraftState[K]) => setState((current) => ({ ...current, [key]: value }));

  function versionPayload(): Record<string, unknown> | null {
    if (!channel || !props.provider || !props.model) return null;
    const base = version;
    return {
      system_prompt: state.systemPrompt, provider: base?.provider ?? props.provider, model: base?.model ?? props.model,
      credential_id: base?.credential_id ?? props.credentialId,
      tool_ids: base?.tool_ids ?? [...new Set([...props.defaultToolIds, "crm_apply_channel_label"])],
      trigger_config: { events: ["message"], filters: { ignore_groups: true, ignore_self: true, keyword_regex: null, business_hours: state.businessHoursEnabled ? { timezone: "America/Sao_Paulo", start: `${String(state.startHour).padStart(2, "0")}:00`, end: `${String(state.endHour).padStart(2, "0")}:00`, weekdays: [1, 2, 3, 4, 5] } : null }, concurrency: "one_per_conversation" },
      channel_session_id: base?.channel_session_id ?? channel.id,
      max_steps: base?.max_steps ?? 10, token_budget: base?.token_budget ?? 50_000, cost_budget_cents: base?.cost_budget_cents ?? 50,
      history_message_window: base?.history_message_window ?? 20, history_token_window: base?.history_token_window ?? 8_000,
      handoff_keywords: state.handoffKeywords.split(",").map((item) => item.trim()).filter(Boolean), handoff_tool_enabled: state.handoffEnabled, cases_enabled: true,
      split_messages: state.humanPacingEnabled, split_max_chars: base?.split_max_chars ?? 600,
      followup: { enabled: state.followupEnabled, flow_pointer_ids: state.followupEnabled ? state.followupFlowIds : [] },
      operator_enabled: base?.operator_enabled ?? true, operator_model: base?.operator_model ?? null,
      operator_tool_ids: base?.operator_tool_ids ?? ["crm_apply_channel_label"], pipeline_ids: base?.pipeline_ids ?? [],
      knowledge_source_ids: base?.knowledge_source_ids ?? [], skill_names: base?.skill_names ?? null,
      channel_config: { ...(base?.channel_config ?? {}), throttle_ms: state.humanPacingEnabled ? 2_000 : 1_200, jitter_max_ms: state.humanPacingEnabled ? 800 : 0, window_start_hour: state.businessHoursEnabled ? state.startHour : 0, window_end_hour: state.businessHoursEnabled ? state.endHour : 24, timezone: "America/Sao_Paulo", max_concurrent_ai_conversations: state.oneConversationAtATime ? 1 : 5 },
    };
  }

  async function saveDraft(): Promise<{ agentId: string; versionId: string } | null> {
    const payload = versionPayload(); if (!payload) return null; setPending("save");
    try {
      if (!agentId) {
        const result = await createMcpAgentAction({ name: state.name, description: state.objective, priority: 0, version: payload });
        if (!result.ok) throw new Error(result.message ?? result.error);
        if (!result.data) throw new Error(t("Não foi possível salvar o atendimento."));
        let createdVersionId = result.data.version_id;
        if (newlyDisabled.length > 0) {
          const audited = await saveAtendimentoDraftAction(
            result.data.agent_id,
            payload,
            { name: state.name, description: state.objective },
            newlyDisabled,
          );
          if (!audited.ok) throw new Error(audited.message ?? audited.error);
          if (!audited.data) throw new Error(t("Não foi possível registrar as travas desligadas."));
          createdVersionId = audited.data.version_id;
        }
        setAgentId(result.data.agent_id); setVersionId(createdVersionId); setSavedState(state); setNewlyDisabled([]); setMcpChanges([]);
        toast.success(t("Rascunho criado.")); return { agentId: result.data.agent_id, versionId: createdVersionId };
      }
      const result = await saveAtendimentoDraftAction(agentId, payload, { name: state.name, description: state.objective }, newlyDisabled);
      if (!result.ok) throw new Error(result.message ?? result.error);
      if (!result.data) throw new Error(t("Não foi possível salvar o atendimento."));
      setVersionId(result.data.version_id); setSavedState(state); setNewlyDisabled([]); setMcpChanges([]); toast.success(t("Rascunho salvo."));
      return { agentId, versionId: result.data.version_id };
    } catch (error) { toast.error(error instanceof Error ? error.message : t("Não foi possível salvar o atendimento.")); return null; }
    finally { setPending(null); }
  }

  async function publish() {
    setPending("publish");
    try {
      const target = dirty || !versionId ? await saveDraft() : agentId && versionId ? { agentId, versionId } : null;
      if (!target) return;
      const result = await publishAgentAction(target.agentId, target.versionId); if (!result.ok) throw new Error(result.message ?? result.error);
      const pacing = await fetch("/api/v1/ai/pacing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_session_id: channel!.id, daily_message_limit: state.dailyCapEnabled ? state.dailyMessageLimit : 10_000 }) });
      if (!pacing.ok) throw new Error(t("O atendimento foi publicado, mas o teto diário não foi aplicado. Revise os limites."));
      toast.success(t("Atendimento publicado.")); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : t("Não foi possível publicar o atendimento.")); }
    finally { setPending(null); }
  }

  async function discard() {
    if (!agentId || !versionId) return; setPending("discard");
    try { const result = await discardMcpDraftAction(agentId, versionId); if (!result.ok) throw new Error(result.message ?? result.error); toast.success(t("Rascunho descartado.")); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("Não foi possível descartar o rascunho.")); }
    finally { setPending(null); }
  }

  async function rollback() {
    if (!agentId || !rollbackVersion) return; setPending("rollback");
    try { const result = await revertToVersionAction(agentId, rollbackVersion); if (!result.ok) throw new Error(result.message ?? result.error); toast.success(t("Versão anterior restaurada e publicada.")); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("Não foi possível voltar para a versão escolhida.")); }
    finally { setPending(null); }
  }

  async function propose() {
    if (!instruction.trim()) return; setPending("propose");
    try { const result = await proposeAttendanceInstructionAction(state.systemPrompt, instruction, version?.provider ?? props.provider!, version?.model ?? props.model!, version?.credential_id ?? props.credentialId); if (!result.ok) throw new Error(t("Não foi possível montar a proposta.")); setField("systemPrompt", result.prompt); setMcpChanges((items) => [...items, ...result.summary]); setInstruction(""); toast.success(t("Proposta colocada no rascunho para sua revisão.")); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("Não foi possível montar a proposta.")); }
    finally { setPending(null); }
  }

  function requestToggle(trava: TravaDoAtendimento, enabled: boolean) {
    if (!trava.toggleable) return; if (!enabled) { setConfirmDisable(trava); return; }
    setState((current) => ({ ...current, disabledGuardrails: current.disabledGuardrails.filter((id) => id !== trava.id), ...(trava.id === "horario" ? { businessHoursEnabled: true } : {}), ...(trava.id === "ritmo_humano" ? { humanPacingEnabled: true } : {}), ...(trava.id === "uma_conversa" ? { oneConversationAtATime: true } : {}), ...(trava.id === "teto_diario" ? { dailyCapEnabled: true } : {}) }));
  }
  function confirmToggleOff() {
    if (!confirmDisable) return; const id = confirmDisable.id;
    setState((current) => ({ ...current, disabledGuardrails: [...new Set([...current.disabledGuardrails, id])], ...(id === "horario" ? { businessHoursEnabled: false } : {}), ...(id === "ritmo_humano" ? { humanPacingEnabled: false } : {}), ...(id === "uma_conversa" ? { oneConversationAtATime: false } : {}), ...(id === "teto_diario" ? { dailyCapEnabled: false } : {}) }));
    setNewlyDisabled((items) => [...new Set([...items, id])]); setConfirmDisable(null);
  }

  const panel = selectedNodeId ? (() => {
    const meta = NODE_META[selectedNodeId]; const sharedLink = agentId ? `/app/ai/agents/${agentId}` : "/app/ai/agents/new"; let content: React.ReactNode;
    if (selectedNodeId === "agente") content = <><div className="space-y-2"><Label htmlFor="flow-agent-name">{t("Nome do agente")}</Label><Input id="flow-agent-name" value={state.name} onChange={(e) => setField("name", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="flow-objective">{t("Objetivo")}</Label><Textarea id="flow-objective" value={state.objective} onChange={(e) => setField("objective", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="flow-prompt">{t("Diretrizes do atendimento")}</Label><Textarea id="flow-prompt" rows={12} value={state.systemPrompt} onChange={(e) => setField("systemPrompt", e.target.value)} /></div><Button variant="outline" asChild><Link href={sharedLink}>{t("Abrir ajuste fino do agente")}</Link></Button></>;
    else if (selectedNodeId === "handoff") content = <><div className="flex items-center justify-between gap-3"><div><Label>{t("Passar para uma pessoa")}</Label><p className="text-xs text-text-muted">{t("O agente abre um caso e interrompe a automação.")}</p></div><Switch checked={state.handoffEnabled} onCheckedChange={(value) => setField("handoffEnabled", value)} /></div><div className="space-y-2"><Label htmlFor="handoff-keywords">{t("Palavras e pedidos que acionam a passagem")}</Label><Textarea id="handoff-keywords" value={state.handoffKeywords} onChange={(e) => setField("handoffKeywords", e.target.value)} /></div><Button variant="outline" asChild><Link href={sharedLink}>{t("Abrir ajuste fino")}</Link></Button></>;
    else if (selectedNodeId === "followup") content = <><div className="flex items-center justify-between gap-3"><Label>{t("Retomar quando a conversa esfriar")}</Label><Switch checked={state.followupEnabled} onCheckedChange={(value) => setField("followupEnabled", value)} /></div>{state.followupEnabled && <div className="space-y-2">{props.followupFlows.length === 0 ? <p className="text-sm text-text-muted">{t("Nenhum fluxo de retomada publicado ainda.")}</p> : props.followupFlows.map((flow) => <label key={flow.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><Switch checked={state.followupFlowIds.includes(flow.id)} onCheckedChange={(checked) => setField("followupFlowIds", checked ? [...state.followupFlowIds, flow.id] : state.followupFlowIds.filter((id) => id !== flow.id))} />{flow.name}</label>)}</div>}<Button variant="outline" asChild><Link href="/app/ai/followups">{t("Ajustar fluxos de follow-up")}</Link></Button></>;
    else if (selectedNodeId === "limites") content = <div className="space-y-3">{travasDoEstado(state).map((trava) => <div key={trava.id} className={cn("rounded-md border p-3", !trava.enabled && "border-warning bg-warning-bg/30")} data-testid={`guardrail-${trava.id}`}><div className="flex items-start justify-between gap-3"><div><Label>{t(trava.label)}</Label><p className="mt-1 text-xs text-text-muted">{trava.toggleable ? t(trava.consequence) : t("Proteção obrigatória do motor. Não pode ser desligada nesta tela.")}</p></div>{trava.toggleable ? <Switch checked={trava.enabled} onCheckedChange={(value) => requestToggle(trava, value)} /> : <Lock size={16} className="mt-1 text-text-muted" aria-label={t("Proteção obrigatória")} />}</div>{trava.id === "horario" && trava.enabled && <div className="mt-3 grid grid-cols-2 gap-2"><Input aria-label={t("Hora de abertura")} type="number" min={0} max={23} value={state.startHour} onChange={(e) => setField("startHour", Number(e.target.value))} /><Input aria-label={t("Hora de fechamento")} type="number" min={1} max={24} value={state.endHour} onChange={(e) => setField("endHour", Number(e.target.value))} /></div>}{trava.id === "teto_diario" && trava.enabled && <Input aria-label={t("Teto de mensagens por dia")} className="mt-3" type="number" min={1} max={10000} value={state.dailyMessageLimit} onChange={(e) => setField("dailyMessageLimit", Number(e.target.value))} />}</div>)}</div>;
    else { const href = selectedNodeId === "entrada" ? "/app/connections" : selectedNodeId === "conhecimento" ? "/app/ai/knowledge" : "/app/ai/skills"; content = <><p className="text-sm text-text-muted">{t(selectedNodeId === "entrada" ? "Este nó usa o canal e a janela que o motor já aplica." : selectedNodeId === "conhecimento" ? "Os materiais marcados no agente alimentam este nó." : "As capacidades publicadas do agente aparecem neste nó.")}</p><Button variant="outline" asChild><Link href={href}>{t("Abrir ajuste fino")}</Link></Button></>; }
    return <NodeConfigPanel node={{ id: selectedNodeId, type: "trigger", position: { x: 0, y: 0 }, data: { label: meta.label, config: {} } }} onChange={() => undefined} onDelete={() => undefined} custom={{ title: meta.label, description: "Configure aqui sem sair do fluxo principal.", icon: meta.icon, chipClassName: meta.chip, content }} hideDelete />;
  })() : null;

  const history = props.versions.filter((item) => item.status === "published" || item.status === "superseded");
  const paletteItems = NODE_ORDER.map((id) => ({ type: id, label: NODE_META[id].label, icon: NODE_META[id].icon, chipClassName: NODE_META[id].chip }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PublishBar mode="atendimento" title={state.name} status={version?.status ?? "draft"} dirty={dirty} changes={mcpChanges} actions={<><Button variant="secondary" size="sm" disabled={!ready || pending !== null} onClick={() => void saveDraft()}>{pending === "save" ? t("Salvando…") : t("Salvar rascunho")}</Button><Button size="sm" disabled={!ready || pending !== null} onClick={() => void publish()}>{pending === "publish" ? t("Publicando…") : t("Publicar")}</Button>{mcpChanges.length > 0 && agentId && versionId && <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => void discard()}>{t("Descartar")}</Button>}<Button variant="outline" size="sm" asChild><Link href={agentId ? `/app/ai/agents/${agentId}` : "/app/ai/agents/new"}>{t("Ajuste fino")}</Link></Button></>} />
      <div className="grid gap-3 border-b bg-muted/20 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex gap-2"><Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} placeholder={t("Descreva em português o que o atendimento deve fazer. A proposta entra como rascunho para você revisar.")} /><Button className="self-stretch" variant="outline" disabled={pending !== null || instruction.trim().length < 10} onClick={() => void propose()}>{pending === "propose" ? t("Montando…") : t("Montar com IA")}</Button></div>
        {history.length > 0 && <div className="flex items-center gap-2"><Select value={rollbackVersion} onValueChange={setRollbackVersion}><SelectTrigger className="w-44"><SelectValue placeholder={t("Histórico de versões")} /></SelectTrigger><SelectContent>{history.map((item) => <SelectItem key={item.id} value={item.id}>v{item.version_number}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={!rollbackVersion || pending !== null} onClick={() => void rollback()}>{t("Voltar")}</Button></div>}
      </div>
      {!ready && <div className="border-b border-warning bg-warning-bg px-4 py-3 text-sm text-warning-fg">{t("Conecte um número e configure um modelo de IA antes de salvar ou publicar.")}</div>}
      {!agentId && <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3"><span className="text-sm font-medium">{t("Começar pelo modelo do nicho")}</span>{TEMPLATE_SUMMARIES.map((item) => <Button key={item.id} size="sm" variant={state.templateId === item.id ? "default" : "outline"} onClick={() => { const next = novoAtendimentoDoModelo(item.id); setState(next); setSavedState(next); }}>{t(item.label)}</Button>)}</div>}
      {!isDesktop && <div className="border-b px-4 py-2 text-xs text-text-muted">{t("No celular você pode ler, configurar e publicar. Para reorganizar os nós, use um computador.")}</div>}
      <FlowBuilderShell><div className="flex min-h-0 flex-1 overflow-hidden">
        <NodePalette onAdd={() => undefined} items={paletteItems} onSelect={(id) => { setSelectedNodeId(id as AtendimentoNodeId); setSelectedEdgeId(null); }} title="Partes do atendimento" draggable={false} />
        <div className="relative min-h-[520px] flex-1" data-testid="atendimento-flow-canvas"><ReactFlowProvider><FlowCanvasSurface nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodesConnectable={false} nodesDraggable={isDesktop} fitView fitViewOptions={{ padding: 0.18 }} onNodeClick={(_, node) => { setSelectedNodeId(node.id as AtendimentoNodeId); setSelectedEdgeId(null); }} onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }} onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }} /></ReactFlowProvider></div>
        {(panel || selectedEdgeId) && <aside className="fixed inset-x-0 bottom-0 z-40 max-h-[74vh] overflow-y-auto rounded-t-lg border bg-surface p-4 shadow-lg lg:static lg:z-auto lg:w-96 lg:shrink-0 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:shadow-none">{panel ?? <EdgeConfigPanel sourceNode={undefined} targetNode={undefined} condition={{ type: "always" }} onChange={() => undefined} onDelete={() => undefined} custom={{ title: "Continuidade do atendimento", description: "Esta ligação mostra como o contexto segue para a próxima parte. A ordem é fixa para que nenhuma proteção fique isolada." }} />}</aside>}
      </div></FlowBuilderShell>
      <AlertDialog open={confirmDisable !== null} onOpenChange={(open) => !open && setConfirmDisable(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("Desligar esta proteção?")}</AlertDialogTitle><AlertDialogDescription>{confirmDisable ? t(confirmDisable.consequence) : ""} {t("A decisão ficará registrada quando o rascunho for salvo.")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("Manter ligada")}</AlertDialogCancel><AlertDialogAction onClick={confirmToggleOff}>{t("Entendo a consequência e quero desligar")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
