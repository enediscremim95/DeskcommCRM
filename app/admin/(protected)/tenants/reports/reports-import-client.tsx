"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type Row = { id: string; url: string };
export function ReportsImportClient() {
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const preview = useMemo(() => raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id = "", url = ""] = line.split(/[;,\t]/).map((part) => part.trim());
    return { id, url };
  }), [raw]);
  async function save() {
    setStatus("Salvando...");
    const results = await Promise.all(rows.map(async (row) => {
      const response = await fetch(`/api/v1/admin/tenants/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report_url: row.url }) });
      return response.ok;
    }));
    setStatus(`${results.filter(Boolean).length} de ${rows.length} relatórios salvos.`);
  }
  return <div className="mx-auto max-w-3xl space-y-5"><div><h1 className="text-2xl font-semibold">Importar relatórios</h1><p className="text-sm text-muted-foreground">Cole CSV, com uma linha por organização: ID,URL.</p></div><textarea className="min-h-56 w-full rounded-md border p-3 font-mono text-sm" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="uuid-da-organizacao,https://relatorio-performance.online/cliente/" /><Button type="button" variant="outline" onClick={() => setRows(preview)} disabled={!preview.length}>Ver prévia</Button>{rows.length > 0 && <div className="rounded-md border p-4"><p className="mb-3 font-medium">Prévia: {rows.length} organizações</p>{rows.map((row) => <div className="flex gap-3 border-t py-2 text-sm" key={row.id}><span className="font-mono">{row.id}</span><span className="truncate">{row.url}</span></div>)}<Button className="mt-4" onClick={() => void save()}>Confirmar importação</Button></div>}{status && <p className="text-sm">{status}</p>}</div>;
}
