"use client";
/**
 * A tela do relatório, separada do `page.tsx` por causa do IDIOMA.
 *
 * O `page.tsx` é Server Component: ele resolve a organização e lê o
 * `report_url`, e é o único lugar onde isso pode acontecer. Só que `useT()` é
 * hook de contexto e não existe no servidor — enquanto os textos moravam lá,
 * eles renderizavam crus, e quem escolheu espanhol lia a tela em português.
 * Acusado por `tests/unit/i18n-espanhol-cobre-a-tela.test.ts`.
 *
 * A divisão é a do resto do produto: o servidor busca, o cliente desenha.
 */
import { useT } from "@/hooks/i18n/useT";
import { TrafficDashboard } from "./_components/TrafficDashboard";

interface RelatorioClientProps {
  reportUrl: string | null;
  nativeConfigured: boolean;
}

export function RelatorioClient({ reportUrl, nativeConfigured }: RelatorioClientProps) {
  const t = useT();

  if (nativeConfigured) return <TrafficDashboard />;

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("Relatório")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Acompanhe o desempenho que foi preparado para sua empresa.")}
          </p>
        </div>
        {reportUrl && (
          <a
            className="inline-flex w-fit rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Abrir em nova aba")}
          </a>
        )}
      </header>
      {reportUrl ? (
        <iframe
          title={t("Relatório de desempenho")}
          src={reportUrl}
          className="min-h-[70vh] w-full flex-1 rounded-md border bg-white"
        />
      ) : (
        <div className="rounded-md border p-6 text-sm">
          <p className="font-medium">{t("Seu relatório ainda não foi configurado.")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("Peça à pessoa que administra sua conta para vincular o endereço do relatório.")}
          </p>
        </div>
      )}
    </div>
  );
}
