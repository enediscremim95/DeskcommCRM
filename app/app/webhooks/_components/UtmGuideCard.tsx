"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { Copy } from "@/lib/ui/icons";

const PADRAO_UTM =
  "?utm_source=meta&utm_medium=cpc&utm_campaign=professores-2026&utm_content=video-01&utm_term=topo";

export function UtmGuideCard() {
  const t = useT();

  const copiar = async () => {
    if (await copyToClipboard(PADRAO_UTM)) {
      toast.success(t("Padrão de UTM copiado."));
      return;
    }
    toast.error(t("Não foi possível copiar. Selecione o padrão e copie manualmente."));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Padrão de UTM para seus anúncios")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "Acrescente este padrão ao fim do endereço da página. Troque somente os exemplos pelos nomes reais da campanha e do anúncio.",
          )}
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-sm border border-border bg-muted px-3 py-2 text-xs">
            {PADRAO_UTM}
          </code>
          <Button type="button" variant="secondary" size="icon" onClick={copiar}>
            <Copy />
            <span className="sr-only">{t("Copiar padrão de UTM")}</span>
          </Button>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="font-medium">utm_source</dt>
            <dd className="text-muted-foreground">{t("canal, como meta")}</dd>
          </div>
          <div>
            <dt className="font-medium">utm_medium</dt>
            <dd className="text-muted-foreground">{t("tipo de mídia, como cpc")}</dd>
          </div>
          <div>
            <dt className="font-medium">utm_campaign</dt>
            <dd className="text-muted-foreground">{t("nome da campanha")}</dd>
          </div>
          <div>
            <dt className="font-medium">utm_content</dt>
            <dd className="text-muted-foreground">{t("anúncio ou criativo")}</dd>
          </div>
          <div>
            <dt className="font-medium">utm_term</dt>
            <dd className="text-muted-foreground">{t("público, palavra ou grupo")}</dd>
          </div>
        </dl>
        <p className="text-xs font-medium text-warning">
          {t("Use letras minúsculas, sem acentos e sem espaços. Separe palavras com hífen.")}
        </p>
      </CardContent>
    </Card>
  );
}
