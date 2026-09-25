"use client";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateWebhookSource,
  usePipelines,
  usePipelineStages,
  type WebhookSourceRow,
} from "@/hooks/webhooks/useWebhookSources";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (source: WebhookSourceRow) => void;
}

export function CreateSourceDialog({ open, onOpenChange, onCreated }: Props) {
  const t = useT();
  const [name, setName] = React.useState("");
  const [pipelineId, setPipelineId] = React.useState<string>("");
  const [stageId, setStageId] = React.useState<string>("");
  const [redirectTo, setRedirectTo] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [step, setStep] = React.useState<1 | 2>(1);

  const { data: pipelinesRes, isLoading: pipelinesLoading } = usePipelines();
  const { data: boardRes, isLoading: stagesLoading } = usePipelineStages(pipelineId || null);
  const create = useCreateWebhookSource();
  const { data: members = [], isLoading: membersLoading } = useAssignableMembers(open);

  const pipelines = pipelinesRes?.data ?? [];
  const stages = boardRes?.data?.stages ?? [];

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setName("");
      setPipelineId("");
      setStageId("");
      setRedirectTo("");
      setOwnerId("");
      setStep(1);
    }
    onOpenChange(nextOpen);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      setStep(2);
      return;
    }
    if (!pipelineId || !stageId) {
      toast.error(t("Escolha o funil e o estágio de entrada."));
      return;
    }
    if (!ownerId) {
      toast.error(t("Escolha quem vai responder os leads desta página."));
      return;
    }
    try {
      const res = await create.mutateAsync({
        name,
        default_pipeline_id: pipelineId,
        default_stage_id: stageId,
        default_owner_user_id: ownerId,
        redirect_to: redirectTo.trim() || undefined,
      });
      toast.success(t("Fonte criada. Agora é só conectar seu site."));
      handleOpenChange(false);
      onCreated(res.data);
    } catch {
      /* erro já mostrado pelo showApiError */
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Conectar uma página")}</DialogTitle>
          <DialogDescription>
            {t(
              "Crie uma entrada própria para cada página. Usar uma fonte única em várias páginas apaga a origem dos leads.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground">
            {step === 1 ? t("Passo 1 de 2: qual página?") : t("Passo 2 de 2: para onde o lead vai?")}
          </p>
          {step === 1 ? (
            <div className="space-y-2">
              <Label htmlFor="src-name">{t("Nome da página ou oferta")}</Label>
              <Input
                id="src-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Dia dos Professores")}
                minLength={1}
                maxLength={120}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t("Esse nome já vai dentro do script para identificar a página em cada lead.")}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>{t("Funil de entrada")}</Label>
                <Select
                  value={pipelineId}
                  onValueChange={(value) => {
                    setPipelineId(value);
                    setStageId("");
                  }}
                  disabled={pipelinesLoading}
                >
                  <SelectTrigger><SelectValue placeholder={t("Escolha o funil")} /></SelectTrigger>
                  <SelectContent>{pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Etapa de entrada")}</Label>
                <Select value={stageId} onValueChange={setStageId} disabled={!pipelineId || stagesLoading}>
                  <SelectTrigger><SelectValue placeholder={pipelineId ? t("Escolha o estágio") : t("Escolha o funil primeiro")} /></SelectTrigger>
                  <SelectContent>{stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Quem responde")}</Label>
                <Select value={ownerId} onValueChange={setOwnerId} disabled={membersLoading}>
                  <SelectTrigger><SelectValue placeholder={t("Escolha uma pessoa")} /></SelectTrigger>
                  <SelectContent>{members.map((member) => <SelectItem key={member.user_id} value={member.user_id}>{member.full_name ?? t("Pessoa sem nome")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="src-redirect">{t("URL de obrigado (opcional)")}</Label>
                <Input id="src-redirect" type="url" value={redirectTo} onChange={(e) => setRedirectTo(e.target.value)} placeholder="https://tusitio.com/gracias" />
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => (step === 1 ? handleOpenChange(false) : setStep(1))}
            >
              {step === 1 ? t("Cancelar") : t("Voltar")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {step === 1 ? t("Continuar") : t("Criar fonte e gerar script")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
