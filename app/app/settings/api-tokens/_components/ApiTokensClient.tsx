"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useState } from "react";
import { toast } from "sonner";

import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  type CreatedApiToken,
} from "@/hooks/team/useApiTokens";
import { copyToClipboard } from "@/lib/clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import Link from "next/link";
import { comandosDoTokenMcp } from "@/lib/mcp/conexao";

/**
 * `mcp:read`/`mcp:write` faltavam nesta lista, e sem eles NENHUMA ferramenta
 * MCP funciona: toda chamada volta "Token missing required scope 'mcp:read'"
 * (lib/mcp/types.ts exige um dos dois em cada tool). Como esta tela é o único
 * lugar que emite token, o "CRM operável por agentes de IA via MCP" ficava
 * inalcançável — a API sempre aceitou os escopos; só o catálogo daqui os
 * escondia.
 */
const SCOPES: { id: string; label: string }[] = [
  { id: "mcp:read", label: "Agentes de IA podem LER o CRM (MCP)" },
  { id: "mcp:write", label: "Agentes de IA podem AGIR no CRM (MCP)" },
  {
    id: "mcp:configure",
    label: "Agentes de IA podem MONTAR o atendimento em rascunho (MCP, não publica)",
  },
  // Sem isto o token nasce como 'agent' e as ferramentas de nível gerente
  // (criar lead, atribuir conversa) respondem "Role 'agent' insufficient".
  // O papel viaja junto dos escopos (ver lib/mcp/auth.ts) e também não
  // aparecia em lugar nenhum da interface.
  { id: "role:manager", label: "Tratar o token como gerente (necessário p/ criar e atribuir)" },
  { id: "contacts:read", label: "Ler contatos" },
  { id: "contacts:write", label: "Criar e editar contatos" },
  { id: "leads:read", label: "Ler leads" },
  { id: "leads:write", label: "Criar e editar leads" },
  { id: "messages:read", label: "Ler mensagens" },
  { id: "messages:write", label: "Enviar mensagens" },
  { id: "audit:read", label: "Ler o log de auditoria" },
];

export function ApiTokensClient({ connectorUrl }: { connectorUrl: string }) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const { data, isLoading } = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [created, setCreated] = useState<CreatedApiToken | null>(null);

  const tokens = data?.data ?? [];
  const comandosCriados = created
    ? comandosDoTokenMcp(connectorUrl, created.scopes, created.plaintext)
    : null;

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scopes.length === 0) {
      toast.error(t("Selecione ao menos um escopo."));
      return;
    }
    try {
      const res = await create.mutateAsync({
        name,
        scopes,
        expires_in_days: expiresInDays ? Number(expiresInDays) : undefined,
      });
      setCreated(res.data);
      setName("");
      setScopes([]);
      setExpiresInDays("");
      setCreateOpen(false);
    } catch {
      /* noop */
    }
  };

  const toggleScope = (s: string) => {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  return (
    <>
      <div className="flex sm:justify-end">
        <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
          {t("Criar token")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhum token criado ainda.")}</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Nome")}</TableHead>
                <TableHead>{t("Prefixo")}</TableHead>
                <TableHead>{t("Escopos")}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>{t("Expira")}</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((tok) => (
                <TableRow key={tok.id}>
                  <TableCell className="font-medium">{tok.name}</TableCell>
                  <TableCell>
                    <code className="text-xs">{tok.prefix}…</code>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {tok.scopes.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {tok.revoked_at ? (
                      <Badge variant="destructive">{t("Revogado")}</Badge>
                    ) : (
                      <Badge variant="default">{t("Ativo")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tok.expires_at ? new Date(tok.expires_at).toLocaleDateString(tagDoIdioma) : t("Sem expiração")}
                  </TableCell>
                  <TableCell>
                    {!tok.revoked_at ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={async () => {
                          await revoke.mutateAsync(tok.id);
                          toast.success(t("Token revogado."));
                        }}
                      >
                        {t("Revogar")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Criar novo token")}</DialogTitle>
            <DialogDescription>
              {t("O plaintext será mostrado apenas uma vez.")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="t-name">{t("Nome")}</Label>
              <Input
                id="t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Worker de import")}
                minLength={2}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Escopos")}</Label>
              {/* Lista com caixinha, e "Marcar todos" como primeira linha: com 9
                  escopos, clicar um por um era o caminho normal. */}
              <div className="grid gap-1.5 rounded-md border p-2">
                <label className="flex cursor-pointer items-center gap-2 border-b pb-1.5 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={scopes.length === SCOPES.length}
                    ref={(el) => {
                      if (el) el.indeterminate = scopes.length > 0 && scopes.length < SCOPES.length;
                    }}
                    onChange={(e) => setScopes(e.target.checked ? SCOPES.map((s) => s.id) : [])}
                  />
                  {t("Marcar todos")}
                </label>
                {SCOPES.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                    title={t(s.label)}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0"
                      checked={scopes.includes(s.id)}
                      onChange={() => toggleScope(s.id)}
                    />
                    <span className="min-w-0">
                      <span className="font-mono text-xs">{s.id}</span>
                      <span className="ml-1 text-muted-foreground">{t(s.label)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-exp">{t("Expira em quantos dias (opcional)")}</Label>
              <Input
                id="t-exp"
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="365"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {t("Cancelar")}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {t("Criar")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Token criado")}</DialogTitle>
            <DialogDescription>
              {t("Copie e guarde agora. Não conseguiremos exibir novamente.")}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="space-y-3">
              <code className="block break-all rounded-md border bg-muted p-3 text-sm">
                {created.plaintext}
              </code>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void copyToClipboard(created.plaintext).then((ok) => {
                    if (ok) toast.success(t("Token copiado."));
                    else toast.error(t("Não foi possível copiar. Selecione o token acima."));
                  });
                }}
              >
                {t("Copiar para clipboard")}
              </Button>
              <p className="text-xs text-muted-foreground">{created._warning}</p>
              {comandosCriados ? (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-sm font-medium">{t("Comando para conectar pelo MCP")}</p>
                  <p className="text-xs text-muted-foreground">{t("O comando exibido protege o token. Ao copiar, o token recém-criado será incluído.")}</p>
                  <code className="block overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">
                    {comandosCriados.exibido}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void copyToClipboard(comandosCriados.copiado).then((ok) => {
                        if (ok) toast.success(t("Comando copiado."));
                        else toast.error(t("Não foi possível copiar. Selecione o comando acima."));
                      });
                    }}
                  >
                    {t("Copiar comando")}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {t("Não salve o token em arquivo de texto.")} {" "}
                    <Link className="underline" href="/app/mcp">
                      {t("Ver instruções completas do conector")}
                    </Link>
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>{t("Fechar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
