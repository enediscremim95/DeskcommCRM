"use client";

import { useT } from "@/hooks/i18n/useT";

import { Button } from "@/components/ui/button";
import * as React from "react";
import { useRouter } from "next/navigation";

import { GoogleLogo } from "@/lib/ui/icons";
import { usePermission } from "@/hooks/auth/AuthProvider";

/**
 * O cartão da agenda conectada — e o caso que importa é o de quem NÃO tem.
 *
 * `GOOGLE_CALENDAR_CLIENT_ID` e `_SECRET` são opcionais (decisão 3.1), então
 * **100% das instalações novas** chegam aqui sem elas. Isso não é borda: é a
 * primeira tela que todo self-hoster vê.
 *
 * Nesse estado o botão NÃO aparece. E não é o mesmo que aparecer desabilitado:
 *
 *   indisponível  (falta o meio, vai ter)      -> existe, disabled, diz o motivo
 *   sem sentido   (não se aplica aqui)         -> não existe
 *   NÃO INSTALADO (a instalação não tem isso)  -> não existe, E a tela explica
 *
 * A terceira é esta, e ela é diferente das outras duas porque quem lê PODE
 * agir — falta uma chave, e há um lugar onde se põe. Botão desabilitado aqui
 * diria "você não pode", quando o certo é "esta instalação ainda não tem".
 */
/** O "G" de quatro cores da marca do Google, nas cores oficiais. */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function CartaoDaConexaoGoogle({
  configurado,
  falta,
  contaConectada,
  enderecoDeRetorno,
  linkDeConfiguracao,
}: {
  configurado: boolean;
  /**
   * Para onde mandar quem PODE resolver — a tela do app OAuth no admin da
   * plataforma. Só vem preenchido para quem administra a INSTALAÇÃO: para o
   * resto, nomear a tela seria oferecer uma porta que dá em `notFound()`.
   */
  linkDeConfiguracao?: string;
  /** O que falta, PELO NOME — para a tela dizer em vez de só esconder o botão. */
  falta: string[];
  contaConectada?: string | null;
  /** O endereço EXATO que o Google exige registrado. Ver o bloco no JSX. */
  enderecoDeRetorno?: string;
}) {
  const t = useT();
  const router = useRouter();
  const podeExcluir = usePermission("resource.delete");
  const [desconectando, setDesconectando] = React.useState(false);

  if (!configurado) {
    return (
      <div
        data-testid="google-nao-configurado"
        className="rounded-lg border border-border bg-surface-elevated/50 p-3"
      >
        <p className="text-sm font-medium text-text">
          {t("Sincronizar com o Google ainda não está disponível")}
        </p>
        {/*
          DUAS FRASES, porque são duas pessoas.
          
          Quem administra a instalação PODE resolver, e para essa pessoa nomear
          variáveis de ambiente é pior que inútil: elas não são mais o caminho —
          a credencial se cadastra pela tela desde a migration 0201. Para quem
          não administra, o texto continua o de antes: dizer o que falta sem
          oferecer uma porta que dá em `notFound()`.
        */}
        {linkDeConfiguracao ? (
          <p className="mt-1 text-xs leading-4 text-text-muted">
            {t(
              "Falta cadastrar o aplicativo do Google desta instalação. Leva um minuto e você faz por aqui mesmo.",
            )}
          </p>
        ) : (
          <p className="mt-1 text-xs leading-4 text-text-muted">
            {t(
              "Esta instalação não tem as credenciais do Google cadastradas — não é nada que você tenha feito. Quem instalou o sistema precisa configurar",
            )}
            {falta.length > 0 ? (
              <>
                {" "}
                <span data-testid="o-que-falta" className="font-mono text-[11px]">
                  {falta.join(` ${t("e")} `)}
                </span>
              </>
            ) : (
              ` ${t("as credenciais")}`
            )}
          </p>
        )}
        {linkDeConfiguracao ? (
          <a
            href={linkDeConfiguracao}
            data-testid="ir-configurar-google"
            className="hover:text-accent-strong mt-2 inline-block text-xs font-medium text-accent underline underline-offset-2"
          >
            {t("Cadastrar as credenciais do Google")}
          </a>
        ) : null}
        {enderecoDeRetorno ? (
          <p className="mt-2 text-xs leading-4 text-text-muted">
            {/* ⚠️ ESTE BLOCO EXISTE PORQUE A AUSÊNCIA DELE JÁ CUSTOU UMA SESSÃO.
                O Google compara o endereço de retorno BYTE A BYTE, e recusa com
                `redirect_uri_mismatch` — um erro que aponta para o Google e não
                para a divergência. Quem cria a credencial no console registra o
                endereço do app (`http://.../`) e não o da ROTA, porque nada no
                produto dizia qual é. Agora diz, e dá para copiar. */}
            {t("E, no console do Google, registrar este endereço de retorno —")}{" "}
            <span className="font-medium">{t("exatamente assim")}</span>:{" "}
            <code
              data-testid="endereco-de-retorno"
              className="font-mono text-[11px] break-all text-text select-all"
            >
              {enderecoDeRetorno}
            </code>
          </p>
        ) : null}
        <p className="mt-2 text-xs leading-4 text-text-muted">
          {t("Até lá a agenda funciona normalmente, só não troca compromissos com o Google.")}
        </p>
      </div>
    );
  }

  if (contaConectada) {
    return (
      <div
        data-testid="google-conectado"
        className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3"
      >
        <GoogleLogo size={16} weight="bold" className="shrink-0 text-text-muted" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="text-text-muted">{t("Agenda conectada:")} </span>
          <span className="font-medium">{contaConectada}</span>
        </p>
        <a href="/app/settings/tenant/agenda" className="text-xs underline">
          {t("Configurar suas agendas")}
        </a>
        {podeExcluir ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="desconectar-google"
            disabled={desconectando}
            onClick={() => {
              setDesconectando(true);
              void fetch("/api/v1/agenda/google/desconectar", { method: "DELETE" })
                .then(async (r) => {
                  if (!r.ok) throw new Error(await r.text());
                  // `refresh` e não estado local: quem sabe se a conexão saiu é o
                  // servidor. Trocar o cartão no cliente repetiria o "Marcado ✓"
                  // que esta mesma entrega acabou de pagar.
                  router.refresh();
                })
                .catch(() => setDesconectando(false));
            }}
          >
            {desconectando ? t("Desconectando…") : t("Desconectar")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">{t("Conecte sua agenda do Google")}</p>
        <p className="mt-0.5 text-sm text-text-muted">
          {t(
            "Você vê aqui o que já está marcado lá, e o que for marcado aqui aparece na sua agenda.",
          )}
        </p>
      </div>
      {/* Botão no padrão da marca do Google: fundo branco, borda #dadce0, texto
          #3c4043 e o "G" de quatro cores. Fixo nos dois temas porque é marca de
          terceiro, não cor do nosso sistema. */}
      <a
        href="/api/v1/agenda/google/connect"
        data-testid="conectar-google"
        className="inline-flex h-10 shrink-0 items-center justify-center gap-3 rounded-[4px] border border-[#dadce0] bg-white px-4 text-sm font-medium text-[#3c4043] shadow-xs transition-colors hover:bg-[#f7f8f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4285f4]"
      >
        <GoogleG />
        <span>{t("Conectar com o Google")}</span>
      </a>
    </div>
  );
}
