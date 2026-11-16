"use client";
import { useT } from "@/hooks/i18n/useT";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api/client";
import type { ProactivePolicy } from "@/lib/proactivity/policy";
export function ProactivityForm({ initial }: { initial: ProactivePolicy }) {
 const t = useT();
 const [form, setForm] = useState(initial);
 const [busy, setBusy] = useState(false);
 return <form className="space-y-4 rounded-lg border p-4" onSubmit={async (e) => {
  e.preventDefault(); setBusy(true);
  try { await apiClient.patch("/api/v1/settings/proactivity", form); toast.success(t("Follow-up proativo salvo.")); }
  catch { toast.error(t("Não foi possível salvar. Recarregue e tente novamente.")); } finally { setBusy(false); }
 }}>
  <h2 className="font-semibold">{t("Follow-up por silêncio")}</h2>
  <p className="text-sm text-muted-foreground">{t("Desligado por padrão. Quando ligado, os fluxos de silêncio publicados podem retomar o contato no horário escolhido e dentro de 24 horas da última mensagem recebida. Etapa e desfecho do negócio continuam sendo decisões humanas.")}</p>
  <label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} disabled={busy} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />{t("Ativar para esta organização")}</label>
  <div className="flex flex-wrap gap-3">
   <label>{t("Tentativas por resposta recebida")}<Input aria-label={t("Limite de tentativas proativas")} type="number" min={1} max={5} value={form.max_attempts} onChange={(e) => setForm({ ...form, max_attempts: Number(e.target.value) })} /></label>
   <label>{t("Início (hora)")}<Input type="number" min={0} max={23} value={form.start_hour} onChange={(e) => setForm({ ...form, start_hour: Number(e.target.value) })} /></label>
   <label>{t("Fim (hora)")}<Input type="number" min={1} max={24} value={form.end_hour} onChange={(e) => setForm({ ...form, end_hour: Number(e.target.value) })} /></label>
   <label>{t("Fuso horário")}<Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></label>
  </div>
  <fieldset className="flex flex-wrap gap-3"><legend>{t("Dias de atendimento")}</legend>{[t("Dom"),t("Seg"),t("Ter"),t("Qua"),t("Qui"),t("Sex"),t("Sáb")].map((day, i) => <label key={day}><input type="checkbox" checked={form.weekdays.includes(i)} onChange={(e) => setForm({ ...form, weekdays: e.target.checked ? [...form.weekdays, i] : form.weekdays.filter((v) => v !== i) })} /> {day}</label>)}</fieldset>
  <Button disabled={busy} type="submit">{t("Salvar follow-up proativo")}</Button>
 </form>;
}
