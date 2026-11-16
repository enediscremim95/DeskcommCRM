"use client";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api/client";
import type { CapturePolicy } from "@/lib/proactivity/capture-policy";
import { toast } from "sonner";
export function CaptureProactivityForm({ initial, channels }: { initial: CapturePolicy; channels: { id: string; display_name: string | null }[] }) {
 const t = useT(); const [form,setForm] = useState(initial); const [busy,setBusy] = useState(false);
 return <form className="space-y-3 rounded-lg border p-4" onSubmit={async (e) => {
  e.preventDefault(); setBusy(true); try { await apiClient.patch("/api/v1/settings/capture-proactivity",form); toast.success(t("Primeiro contato salvo.")); }
  catch { toast.error(t("Não foi possível salvar o primeiro contato.")); } finally { setBusy(false); }
 }}>
 <h2 className="font-semibold">{t("Primeiro contato após formulário")}</h2>
 <p className="text-sm text-muted-foreground">{t("Desligado por padrão. Tenta WhatsApp, uma variante equivalente do telefone e e-mail. Se não conseguir, destaca o card para revisão humana. Uma resposta interrompe a sequência.")}</p>
 <label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form,enabled:e.target.checked })} />{t("Ativar primeiro contato nesta organização")}</label>
 <label className="block">{t("Canal do primeiro contato")}<select className="block min-h-10 w-full rounded-md border p-2" value={form.channel_session_id ?? ""} onChange={(e) => setForm({ ...form,channel_session_id:e.target.value || null })}><option value="">{t("Escolha um canal")}</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.display_name ?? t("Canal sem nome")}</option>)}</select></label>
 <label className="block">{t("Mensagem de WhatsApp")}<textarea className="block min-h-24 w-full rounded-md border p-2" value={form.whatsapp_text} onChange={(e) => setForm({ ...form,whatsapp_text:e.target.value })} /></label>
 <label className="block">{t("Assunto do e-mail")}<Input value={form.email_subject} onChange={(e) => setForm({ ...form,email_subject:e.target.value })} /></label>
 <label className="block">{t("Mensagem de e-mail")}<textarea className="block min-h-24 w-full rounded-md border p-2" value={form.email_text} onChange={(e) => setForm({ ...form,email_text:e.target.value })} /></label>
 <div className="flex flex-wrap gap-3"><label>{t("Tentativas de WhatsApp")}<Input type="number" min={1} max={2} value={form.max_whatsapp_attempts} onChange={(e) => setForm({ ...form,max_whatsapp_attempts:Number(e.target.value) })} /></label><label>{t("Início do expediente")}<Input type="number" min={0} max={23} value={form.start_hour} onChange={(e) => setForm({ ...form,start_hour:Number(e.target.value) })} /></label><label>{t("Fim do expediente")}<Input type="number" min={1} max={24} value={form.end_hour} onChange={(e) => setForm({ ...form,end_hour:Number(e.target.value) })} /></label><label>{t("Fuso do primeiro contato")}<Input value={form.timezone} onChange={(e) => setForm({ ...form,timezone:e.target.value })} /></label></div>
 <p className="text-sm text-muted-foreground">{t("O e-mail precisa estar configurado com o remetente exclusivo desta empresa. Sem ele, a falha fica visível no card. Números ambíguos são encaminhados para revisão.")}</p>
 <Button type="submit" disabled={busy}>{t("Salvar primeiro contato")}</Button>
 </form>;
}
