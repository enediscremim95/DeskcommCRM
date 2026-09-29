"use client";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  useEntryOptions,
  type WebhookSourceRow,
} from "@/hooks/webhooks/useWebhookSources";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { resolveVocabulary } from "@/lib/kanban/vocabulary";

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
  const [mergeRepeatedSubmissions, setMergeRepeatedSubmissions] = React.useState(false);
  const [step, setStep] = React.useState<1 | 2>(1);

  const { data: entryOptionsRes, isLoading: destinationsLoading } = useEntryOptions(open);
  const create = useCreateWebhookSource();
  const { data: members = [], isLoading: membersLoading } = useAssignableMembers(open);

  const entryOptions = entryOptionsRes?.data;
  const pipelines = entryOptions?.pipelines ?? [];
  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null;
  const stages = selectedPipeline?.stages ?? [];
  const vocabulary = resolveVocabulary(selectedPipeline?.vocabulary);
  const semFunis = !destinationsLoading && pipelines.length === 0;
  const semEtapas = Boolean(pipelineId) && !destinationsLoading && stages.length === 0;

  React.useEffect(() => {
    if (!open || !entryOptions || pipelineId) return;
    setPipelineId(entryOptions.default_pipeline_id ?? "");
    setStageId(entryOptions.default_stage_id ?? "");
  }, [entryOptions, open, pipelineId]);

  React.useEffect(() => {
    if (!open || !pipelineId) return;
    setStageId((current) =>
      stages.some((stage) => stage.id === current) ? current : (stages[0]?.id ?? ""),
    );
  }, [open, pipelineId, stages]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setName("");
      setPipelineId("");
      setStageId("");
      setRedirectTo("");
      setOwnerId("");
      setMergeRepeatedSubmissions(false);
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
      toast.error(t("Escolha o funil e a etapa de entrada."));
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
        merge_repeated_submissions: mergeRepeatedSubmissions,
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
            {step === 1
              ? t("Passo 1 de 2: qual página?")
              : `${t("Passo 2 de 2: destino para")} ${vocabulary.lead}`}
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
                    const nextPipeline = pipelines.find((pipeline) => pipeline.id === value);
                    setPipelineId(value);
                    setStageId(nextPipeline?.stages[0]?.id ?? "");
                  }}
                  disabled={destinationsLoading || semFunis}
                >
                  <SelectTrigger aria-label={t("Funil de entrada")}>
                    <SelectValue placeholder={t("Escolha o funil")} />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((pipeline) => (
                      <SelectItem key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {semFunis ? (
                  <p role="alert" className="text-sm text-error">
                    {t(
                      "Não há funil ativo disponível. Crie ou reative um funil antes de conectar a página.",
                    )}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>{t("Etapa de entrada")}</Label>
                <Select
                  value={stageId}
                  onValueChange={setStageId}
                  disabled={!pipelineId || destinationsLoading || semEtapas}
                >
                  <SelectTrigger aria-label={t("Etapa de entrada")}>
                    <SelectValue
                      placeholder={
                        pipelineId ? t("Escolha a etapa") : t("Escolha o funil primeiro")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {semEtapas ? (
                  <p role="alert" className="text-sm text-error">
                    {t("Não há etapa de entrada disponível para")} {vocabulary.lead}.{" "}
                    {t("Crie ou reabra uma etapa em Etapas do funil.")}
                  </p>
                ) : null}
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
              <div className="flex items-start justify-between gap-4 rounded-sm border border-border p-3">
                <div className="space-y-1">
                  <Label htmlFor="src-merge-repeated">
                    {t("Esta origem pode repetir o mesmo envio")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Ative se a ferramenta às vezes manda a mesma pessoa mais de uma vez. Os envios próximos ficam no mesmo card.",
                    )}
                  </p>
                </div>
                <Switch
                  id="src-merge-repeated"
                  checked={mergeRepeatedSubmissions}
                  onCheckedChange={setMergeRepeatedSubmissions}
                />
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
            <Button
              type="submit"
              disabled={
                create.isPending ||
                (step === 2 && (!pipelineId || !stageId || semFunis || semEtapas))
              }
            >
              {step === 1 ? t("Continuar") : t("Criar fonte e gerar script")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
