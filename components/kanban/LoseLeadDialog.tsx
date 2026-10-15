"use client";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLoseLead } from "@/hooks/kanban/useUpdateLead";
import {
  entradaDePerda,
  motivoPedeDetalhe,
  opcoesDeMotivoDaPerda,
} from "@/lib/leads/motivo-da-perda";
import type { Lead } from "@/lib/types/leads";

interface LoseLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  pipelineId: string;
  lostReasons?: string[];
  onBeforeSubmit?: () => void;
  onLost?: (lead: Lead) => void;
  onError?: () => void;
}

const MAX_LEN = 500;

export function LoseLeadDialog({
  open,
  onOpenChange,
  leadId,
  pipelineId,
  lostReasons,
  onBeforeSubmit,
  onLost,
  onError,
}: LoseLeadDialogProps) {
  const t = useT();
  const [reasonCode, setReasonCode] = useState<string>("");
  const [otherText, setOtherText] = useState("");
  const mutation = useLoseLead(pipelineId);
  const reasonOptions = opcoesDeMotivoDaPerda(lostReasons);

  const input = entradaDePerda(reasonCode, otherText);
  const disabled = !reasonCode || otherText.length > MAX_LEN || mutation.isPending;

  const handleSubmit = async () => {
    if (disabled) return;
    onBeforeSubmit?.();
    try {
      const result = await mutation.mutateAsync({ leadId, input });
      setReasonCode("");
      setOtherText("");
      onOpenChange(false);
      onLost?.(result.data);
    } catch {
      onError?.();
      // error already toasted
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Marcar como perdido")}</DialogTitle>
          <DialogDescription>
            {t("Informe o motivo. Essa informação ajuda a melhorar o funil.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Label>{t("Motivo")}</Label>
          <div className="grid grid-cols-1 gap-1.5">
            {reasonOptions.map((reason) => (
              <label
                key={reason.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name="lost-reason"
                  value={reason.value}
                  checked={reasonCode === reason.value}
                  onChange={(e) => setReasonCode(e.target.value)}
                />
                <span>{reason.value === reason.label ? reason.label : t(reason.label)}</span>
              </label>
            ))}
          </div>
          {motivoPedeDetalhe(reasonCode) && (
            <div className="grid gap-1.5">
              <Label htmlFor="lost-reason-other">{t("Detalhe (opcional)")}</Label>
              <Textarea
                id="lost-reason-other"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder={t("Ex: Cliente desistiu por X motivo")}
                maxLength={MAX_LEN}
                rows={3}
              />
              <div className="text-right text-[11px] text-muted-foreground tabular-nums">
                {otherText.length}/{MAX_LEN}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t("Cancelar")}
          </Button>
          <Button onClick={handleSubmit} disabled={disabled}>
            {mutation.isPending ? t("Salvando...") : t("Confirmar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
