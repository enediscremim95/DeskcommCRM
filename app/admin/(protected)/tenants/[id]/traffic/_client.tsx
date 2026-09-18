"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { CONVERSION_FIELDS } from "@/lib/windsor/types";

interface Account { id: string; name: string; platform: "meta_ads" | "google_ads"; currency: string }
interface SavedAccount { account_id: string; account_name: string; platform: Account["platform"]; currency: string }
interface ConfigResponse { data: { config: null | { model: "leads" | "messages" | "ecommerce"; conversion_fields: string[]; sync_status: string; last_sync_succeeded_at: string | null; last_sync_error: string | null }; accounts: SavedAccount[] } }
interface AccountsResponse { data: { accounts: Account[] } }
interface DetectionResponse { data: { objectives: string[]; fields: Array<{ field: string; total: number }> } }
const NONE = "__none__";

export function TrafficDashboardAdmin({ organizationId }: { organizationId: string }) {
  const t = useT();
  const idioma = useIdioma();
  const [catalog, setCatalog] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [model, setModel] = useState<"leads" | "messages" | "ecommerce">("leads");
  const [primaryField, setPrimaryField] = useState<string>("actions_lead");
  const [secondaryField, setSecondaryField] = useState<string>(NONE);
  const [detection, setDetection] = useState<DetectionResponse["data"] | null>(null);
  const [status, setStatus] = useState<string>("");
  const [syncState, setSyncState] = useState<{ status?: string; at?: string | null; error?: string | null }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/v1/admin/windsor/accounts"),
      fetch(`/api/v1/admin/tenants/${organizationId}/traffic-dashboard`),
    ]).then(async ([accountsResponse, configResponse]) => {
      if (!accountsResponse.ok || !configResponse.ok) throw new Error("traffic_configuration_load_failed");
      return Promise.all([
        accountsResponse.json() as Promise<AccountsResponse>,
        configResponse.json() as Promise<ConfigResponse>,
      ]);
    }).then(([accountsBody, configBody]) => {
      if (!alive) return;
      setCatalog(accountsBody.data?.accounts ?? []);
      const config = configBody.data?.config;
      const accounts = configBody.data?.accounts ?? [];
      if (config) {
        setModel(config.model);
        setPrimaryField(config.conversion_fields[0] ?? "actions_lead");
        setSecondaryField(config.conversion_fields[1] ?? NONE);
        setSyncState({ status: config.sync_status, at: config.last_sync_succeeded_at, error: config.last_sync_error });
      }
      setSelected(accounts.map((account) => account.account_id));
    }).catch(() => alive && setStatus(t("Não foi possível carregar a configuração.")));
    return () => { alive = false; };
  }, [organizationId, t]);

  const selectedAccounts = useMemo(() => catalog.filter((account) => selected.includes(account.id)), [catalog, selected]);
  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  async function detect() {
    const id = selected[0];
    if (!id) return;
    setBusy(true); setDetection(null);
    try {
      const response = await fetch(`/api/v1/admin/windsor/conversions?account_id=${encodeURIComponent(id)}`);
      const body = await response.json() as DetectionResponse;
      if (!response.ok) throw new Error();
      setDetection(body.data);
    } catch { setStatus(t("Não foi possível detectar as conversões agora.")); }
    finally { setBusy(false); }
  }
  async function save() {
    if (selectedAccounts.length === 0) { setStatus(t("Escolha pelo menos uma conta.")); return; }
    setBusy(true); setStatus("");
    try {
      const fields = [primaryField, secondaryField === NONE ? null : secondaryField].filter((value): value is string => Boolean(value));
      const response = await fetch(`/api/v1/admin/tenants/${organizationId}/traffic-dashboard`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model, conversion_fields: fields,
          revenue_field: model === "ecommerce" ? (selectedAccounts.some((account) => account.platform === "google_ads") ? "conversion_value" : "action_values_purchase") : null,
          accounts: selectedAccounts.map((account) => ({
            account_id: account.id, platform: account.platform, account_name: account.name, currency: account.currency,
          })),
        }),
      });
      if (!response.ok) throw new Error();
      setStatus(t("Configuração salva. Rode a primeira sincronização."));
      setSyncState((current) => ({ ...current, status: "pending", error: null }));
    } catch { setStatus(t("Não foi possível salvar a configuração.")); }
    finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setStatus(t("Sincronizando…"));
    try {
      const response = await fetch(`/api/v1/admin/tenants/${organizationId}/traffic-dashboard/sync`, { method: "POST" });
      if (!response.ok) throw new Error();
      setStatus(t("Sincronização concluída."));
      setSyncState({ status: "ready", at: new Date().toISOString(), error: null });
    } catch {
      setStatus(t("A sincronização falhou. O último dado bom foi preservado."));
      setSyncState((current) => ({ ...current, status: "failed" }));
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{t("Integração da instalação")}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{t("Dashboard nativo de tráfego")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("Escolha exatamente quais contas esta organização pode ver. A chave Windsor nunca é enviada ao navegador.")}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold">{t("1. Contas visíveis")}</h3>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {catalog.map((account) => (
              <label key={account.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
                <input type="checkbox" checked={selected.includes(account.id)} onChange={() => toggle(account.id)} className="mt-1" />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{account.name}</span>
                  <span className="block text-xs text-muted-foreground">{account.platform === "meta_ads" ? "Meta Ads" : "Google Ads"} · {account.currency} · {account.id}</span></span>
              </label>
            ))}
            {catalog.length === 0 && <p className="text-sm text-muted-foreground">{t("Nenhuma conta retornada pelo Windsor.")}</p>}
          </div>
        </div>
        <div className="grid gap-5 rounded-xl border bg-card p-5 md:grid-cols-3">
          <div className="space-y-2"><Label>{t("2. Modelo")}</Label>
            <Select value={model} onValueChange={(value) => setModel(value as typeof model)}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="leads">{t("Leads")}</SelectItem><SelectItem value="messages">{t("Mensagens iniciadas")}</SelectItem>
                <SelectItem value="ecommerce">{t("E-commerce")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>{t("3. Conversão principal")}</Label>
            <Select value={primaryField} onValueChange={setPrimaryField}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONVERSION_FIELDS.map((field) => <SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>{t("Conversão adicional")}</Label>
            <Select value={secondaryField} onValueChange={setSecondaryField}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>{t("Nenhuma")}</SelectItem>
                {CONVERSION_FIELDS.filter((field) => field !== primaryField).map((field) => <SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={detect} disabled={busy || selected.length === 0}>{t("Detectar na primeira conta")}</Button>
            <Button onClick={save} disabled={busy}>{t("Salvar configuração")}</Button>
            <Button variant="secondary" onClick={sync} disabled={busy || syncState.status === "syncing"}>{t("Sincronizar agora")}</Button>
          </div>
          {detection && <div className="md:col-span-3 rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium">{t("Sinais dos últimos 30 dias")}</p>
            <p className="mt-1 text-muted-foreground">{t("Objetivos")}: {detection.objectives.join(", ") || "—"}</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {detection.fields.filter((item) => item.total > 0).map((item) => <li key={item.field}>{item.field}: <strong>{item.total}</strong></li>)}
            </ul>
          </div>}
        </div>
      </section>
      <aside className="h-fit rounded-xl border bg-card p-5">
        <h3 className="font-semibold">{t("Estado da sincronização")}</h3>
        <p className="mt-3 text-sm">{t("Status")}: <strong>{syncState.status ?? t("Não configurado")}</strong></p>
        {syncState.at && <p className="mt-1 text-xs text-muted-foreground">
          {new Date(syncState.at).toLocaleString(idioma === "es" ? "es-ES" : "pt-BR")}
        </p>}
        {syncState.error && <p className="mt-3 text-sm text-destructive">{syncState.error}</p>}
        {status && <p role="status" className="mt-4 rounded-lg bg-muted p-3 text-sm">{status}</p>}
      </aside>
    </div>
  );
}
