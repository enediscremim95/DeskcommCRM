import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { comandoClaudeMcp, urlDoConectorMcp } from "@/lib/mcp/conexao";
import { carregarBaseApresentacaoMcp } from "@/lib/mcp/contexto-apresentacao";
import { montarApresentacaoMcp, papelDoTokenMcp } from "@/lib/mcp/apresentacao";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { McpCopyButton } from "./_components/McpCopyButton";

export const dynamic = "force-dynamic";

export default async function McpPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");

  const t = (texto: string) => traduzir(texto, user.idioma);
  const supabase = await createClient();
  const { data: tokenRows } = await supabase
    .from("api_tokens")
    .select("id, name, scopes, last_used_at, created_at, revoked_at, expires_at")
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });
  const tokens = (tokenRows ?? []).filter((token) => {
    const scopes = Array.isArray(token.scopes) ? token.scopes : [];
    return scopes.includes("mcp:read") || scopes.includes("mcp:write");
  });
  const baseApresentacao = await carregarBaseApresentacaoMcp(activeOrg.orgId, supabase);
  const connectorUrl = urlDoConectorMcp(env.NEXT_PUBLIC_APP_URL);
  const command = comandoClaudeMcp(connectorUrl);
  const dateLocale = user.idioma === "es" ? "es-ES" : "pt-BR";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">MCP</h1>
        <p className="text-muted-foreground">
          {t("Conecte seu assistente, como Claude ou ChatGPT, ao CRM.")}
        </p>
        <p className="text-muted-foreground">
          {t("Ele poderá consultar e registrar informações conforme as permissões do token.")}
        </p>
      </header>

      <section className="space-y-3 rounded-lg border p-4 sm:p-5">
        <h2 className="text-lg font-semibold">{t("Endereço do conector")}</h2>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 text-sm break-all">
            {connectorUrl}
          </code>
          <McpCopyButton value={connectorUrl} label={t("Copiar endereço")} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("Cabeçalho de autorização:")} <code>Authorization: Bearer SEU_TOKEN</code>
        </p>
      </section>

      <section className="space-y-4 rounded-lg border p-4 sm:p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("Conectar no Claude Code")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Cole o comando abaixo no terminal depois de criar seu token.")}
          </p>
        </div>
        <code className="block min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-sm">
          {command}
        </code>
        <McpCopyButton value={command} label={t("Copiar comando")} />

        <div className="space-y-2 border-t pt-4">
          <h3 className="font-medium">{t("Conectar em outro aplicativo ou site")}</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("Abra Configurações e procure Conectores.")}</li>
            <li>{t("Adicione um conector personalizado usando o endereço acima.")}</li>
            <li>{t("Informe o mesmo cabeçalho de autorização com o seu token.")}</li>
          </ol>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t("Tokens com acesso MCP")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("O token completo aparece apenas uma vez, logo após a criação.")}
            </p>
          </div>
          <Button asChild>
            <Link href="/app/settings/api-tokens">{t("Criar ou gerenciar tokens")}</Link>
          </Button>
        </div>

        {tokens.length === 0 ? (
          <p className="rounded-md bg-muted p-4 text-sm">
            {t("Ainda não há token com escopo mcp:read ou mcp:write.")}
          </p>
        ) : (
          <div className="grid gap-4">
            {tokens.map((token) => {
              const scopes = Array.isArray(token.scopes)
                ? token.scopes.filter((scope): scope is string => typeof scope === "string")
                : [];
              const expired = token.expires_at && new Date(token.expires_at) < new Date();
              const inactive = Boolean(token.revoked_at || expired);
              const presentation = montarApresentacaoMcp({
                ...baseApresentacao,
                tokenName: token.name,
                role: papelDoTokenMcp(scopes),
                scopes,
              });
              return (
                <article key={token.id} className="min-w-0 space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{token.name}</h3>
                    <Badge variant={inactive ? "destructive" : "default"}>
                      {inactive ? t("Inativo") : t("Ativo")}
                    </Badge>
                    {scopes.includes("mcp:read") ? <Badge variant="secondary">mcp:read</Badge> : null}
                    {scopes.includes("mcp:write") ? <Badge variant="secondary">mcp:write</Badge> : null}
                  </div>
                  <dl className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium text-foreground">{t("Criado:")} </dt>
                      <dd className="inline">{new Date(token.created_at).toLocaleString(dateLocale)}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground">{t("Último uso:")} </dt>
                      <dd className="inline">
                        {token.last_used_at
                          ? new Date(token.last_used_at).toLocaleString(dateLocale)
                          : t("Ainda não usado")}
                      </dd>
                    </div>
                  </dl>
                  <details className="rounded-md bg-muted p-3">
                    <summary className="cursor-pointer font-medium">{t("O que sua IA vai saber")}</summary>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm">
                      {presentation}
                    </pre>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-4 sm:p-5">
          <h2 className="text-lg font-semibold">{t("O que a IA pode fazer")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Com mcp:read, consulta dados. Com mcp:write, registra e altera dados, respeitando o papel do token.")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("Sem esses escopos, a ação correspondente é recusada pelo servidor.")}
          </p>
        </div>
        <div className="space-y-2 rounded-lg border p-4 sm:p-5">
          <h2 className="text-lg font-semibold">{t("Teste em um minuto")}</h2>
          <p className="text-sm text-muted-foreground">{t("Peça ao seu assistente:")}</p>
          <blockquote className="rounded-md bg-muted p-3 text-sm font-medium">
            {t("Liste meus últimos 5 leads.")}
          </blockquote>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border p-4 sm:p-5">
        <h2 className="text-lg font-semibold">{t("Cuide do token como a chave da sua casa")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Não salve o token em arquivo de texto. A configuração do conector guarda esse dado para você.")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("Se houver vazamento, revogue o token e gere outro. A revogação corta o acesso imediatamente.")}
        </p>
      </section>
    </div>
  );
}
