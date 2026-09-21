"use client";

import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useBulkAction } from "@/hooks/kanban/useBulkAction";

interface DeleteLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  leadIds: string[];
  leadTitle?: string;
  onDeleted?: () => void;
}

export function DeleteLeadDialog({
  open,
  onOpenChange,
  pipelineId,
  leadIds,
  leadTitle,
  onDeleted,
}: DeleteLeadDialogProps) {
  const t = useT();
  const bulk = useBulkAction(pipelineId);
  const individual = leadIds.length === 1 && Boolean(leadTitle);

  const excluir = () => {
    bulk.mutate(
      { action: "delete", lead_ids: leadIds, params: {} },
      {
        onSuccess: (res) => {
          const quantidade = res.data.updated_count;
          toast.success(
            quantidade === 1 ? t("Lead excluído.") : `${quantidade} ${t("leads excluídos.")}`,
          );
          onOpenChange(false);
          onDeleted?.();
        },
      },
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {individual
              ? `${t("Excluir o lead")} “${leadTitle}”?`
              : `${t("Excluir")} ${leadIds.length} ${t(
                  leadIds.length === 1 ? "selecionado" : "selecionados",
                )}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {individual
              ? t("Este lead será excluído permanentemente. Esta ação não pode ser desfeita.")
              : t(
                  "Os leads selecionados serão excluídos permanentemente. Esta ação não pode ser desfeita.",
                )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={bulk.isPending}>
            {t("Cancelar")}
          </Button>
          <Button variant="destructive" onClick={excluir} disabled={bulk.isPending}>
            {bulk.isPending ? t("Excluindo…") : t("Excluir")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
