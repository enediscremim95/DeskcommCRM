"use client";

import { useQuery } from "@tanstack/react-query";
import { addDays } from "date-fns";
import * as React from "react";

import { PainelDeMarcacao } from "@/components/agenda/PainelDeMarcacao";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useHorariosLivres } from "@/hooks/agenda/useHorariosLivres";
import { useMarcarAgendamento } from "@/hooks/agenda/useMarcarAgendamento";
import { usePessoasDaAgenda } from "@/hooks/agenda/usePessoasDaAgenda";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { diaLocalISO, partesNoFuso } from "@/lib/agenda/fuso";
import { rotuloDoLocal } from "@/lib/agenda/locais";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface TipoDaAgenda {
  id: string;
  name: string;
  duration_minutes: number;
  location_kind: string | null;
  location_details: string | null;
  is_active: boolean;
}

interface Props {
  aberto: boolean;
  aoMudarAbertura: (aberto: boolean) => void;
  leadId: string;
  contactId: string | null;
  conversationId: string | null;
  nomeDoLead: string;
}

const TIPOS_VAZIOS: TipoDaAgenda[] = [];

function rotuloDaHora(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso);
  return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

/**
 * Porta da ficha do lead para a máquina única da Agenda.
 *
 * Esta peça só fixa contexto: lead, contato e a pessoa autenticada. Escolher
 * dia, horário e confirmar continua pertencendo ao `PainelDeMarcacao`.
 */
export function MarcacaoDoLead({
  aberto,
  aoMudarAbertura,
  leadId,
  contactId,
  conversationId,
  nomeDoLead,
}: Props) {
  const t = useT();
  const { user } = useAuth();
  const marcar = useMarcarAgendamento();
  const { data: pessoas = [] } = usePessoasDaAgenda();
  const [tipoId, setTipoId] = React.useState<string | null>(null);

  const tiposQuery = useQuery({
    queryKey: ["agenda", "tipos"],
    enabled: aberto,
    queryFn: async () => {
      const resposta = await apiClient.get<{ data: TipoDaAgenda[] }>("/api/v1/agenda/tipos");
      const tipos = (resposta as unknown as { data?: TipoDaAgenda[] }).data ?? [];
      return tipos.filter((tipo) => tipo.is_active);
    },
  });
  const tipos = tiposQuery.data ?? TIPOS_VAZIOS;
  const tipo = tipos.find((item) => item.id === tipoId) ?? tipos[0] ?? null;

  const [janela] = React.useState(
    () => ({ de: new Date().toISOString(), ate: addDays(new Date(), 30).toISOString() }),
  );
  const horariosQuery = useHorariosLivres(
    aberto && tipo
      ? {
          event_type_id: tipo.id,
          owner_user_id: user.id,
          de: janela.de,
          ate: janela.ate,
        }
      : null,
  );
  const horarios = horariosQuery.data;
  const fuso = horarios?.fuso_da_regra;
  const horariosPorDia = React.useMemo(() => {
    const mapa: Record<string, Array<{ instante: string; rotulo: string }>> = {};
    if (!fuso) return mapa;
    for (const slot of horarios?.slots ?? []) {
      const instante = new Date(slot.inicio);
      const dia = diaLocalISO(instante, fuso);
      (mapa[dia] ??= []).push({ instante: slot.inicio, rotulo: rotuloDaHora(instante, fuso) });
    }
    return mapa;
  }, [fuso, horarios]);

  const responsavel = pessoas.find((pessoa) => pessoa.id === user.id) ?? {
    id: user.id,
    nome: user.full_name ?? user.email.split("@")[0] ?? t("Você"),
    trilha: 1 as const,
  };

  return (
    <Sheet open={aberto} onOpenChange={aoMudarAbertura}>
      <SheetContent
        side="right"
        className="flex w-full flex-col overflow-y-auto sm:max-w-3xl lg:max-w-[1040px] lg:overflow-hidden"
      >
        <SheetHeader>
          <SheetTitle>{t("Marcar compromisso")}</SheetTitle>
        </SheetHeader>

        {tiposQuery.isPending ? (
          <p className="mt-4 text-sm text-text-muted">{t("Carregando agenda…")}</p>
        ) : tipos.length === 0 ? (
          <p className="mt-4 rounded-md border border-border bg-surface-sunken p-3 text-sm text-text-muted">
            {t("Cadastre um tipo de agendamento para começar")}
          </p>
        ) : (
          <>
            {tipos.length > 1 ? (
              <div className="mt-4" data-testid="tipos-de-agendamento">
                <p className="mb-2 text-xs font-medium text-text-muted">{t("Tipo de agendamento")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {tipos.map((opcao) => (
                    <button
                      key={opcao.id}
                      type="button"
                      data-testid={`tipo-${opcao.id}`}
                      aria-pressed={opcao.id === tipo?.id}
                      onClick={() => setTipoId(opcao.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors duration-fast",
                        opcao.id === tipo?.id
                          ? "border-transparent bg-accent text-accent-foreground"
                          : "border-border text-text-muted hover:border-border-strong hover:text-text",
                      )}
                    >
                      {opcao.name}
                      <span className="ml-1 opacity-70 tabular-nums">{opcao.duration_minutes}min</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {tipo ? (
              <div className="mt-4 lg:min-h-0 lg:flex-1">
                <PainelDeMarcacao
                  className="lg:h-full"
                  ancora={new Date()}
                  agora={new Date()}
                  responsavel={responsavel}
                  tipo={tipo.name}
                  duracaoMin={tipo.duration_minutes}
                  local={rotuloDoLocal(tipo.location_kind, tipo.location_details)}
                  fuso={fuso}
                  horariosPorDia={horariosPorDia}
                  publicouHorarios={horarios?.publicou_horarios ?? true}
                  erroAoCarregar={horariosQuery.isError}
                  fusoSuposto={horarios?.fuso_suposto ?? false}
                  fontesDefasadas={horarios?.fontes_defasadas}
                  googleCoberturaParcial={horarios?.google_cobertura_parcial}
                  onConfirmar={(instante) =>
                    marcar.mutateAsync({
                      event_type_id: tipo.id,
                      starts_at: instante,
                      owner_user_id: user.id,
                      lead_id: leadId,
                      contact_id: contactId ?? undefined,
                      conversation_id: conversationId ?? undefined,
                      title: `${tipo.name}: ${nomeDoLead}`,
                    })
                  }
                />
              </div>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
