import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { marcaDaSaida } from "@/lib/branding/saida";
import {
  renderTrafficSummaryPdf,
  type TrafficSummarySource,
} from "@/lib/windsor/traffic-summary-pdf";

import { GET as getTrafficReport } from "../route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    language: z.enum(["pt-BR", "es"]).default("pt-BR"),
  })
  .superRefine((value, context) => {
    const from = new Date(`${value.from}T00:00:00Z`);
    const to = new Date(`${value.to}T00:00:00Z`);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0 || days > 92) {
      context.addIssue({ code: "custom", message: "Período deve ter até 92 dias." });
    }
  });

type TrafficReportEnvelope = {
  data?: TrafficSummarySource & { organization_key: string };
  error?: { message?: string };
};

function safeFilename(from: string, to: string): string {
  return `relatorio-resumido-${from}-a-${to}.pdf`;
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    from: params.get("from"),
    to: params.get("to"),
    language: params.get("language") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_error", "Período ou idioma inválido.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  // O GET canônico já aplica requireRole("viewer"), resolve o tenant pela sessão,
  // filtra toda leitura por organization_id e calcula a mesma régua exibida na tela.
  // Chamar a função diretamente evita uma segunda implementação de métricas e não
  // faz uma requisição HTTP interna que dependeria da URL pública da instalação.
  const reportResponse = await getTrafficReport(request);
  if (!reportResponse.ok) return reportResponse;

  const envelope = (await reportResponse.json()) as TrafficReportEnvelope;
  if (!envelope.data) {
    return fail("internal_error", "Não foi possível montar o relatório.", 500, { requestId });
  }

  const brand = await marcaDaSaida(envelope.data.organization_key);
  const pdf = await renderTrafficSummaryPdf({
    source: envelope.data,
    brand,
    language: parsed.data.language,
  });
  const filename = safeFilename(parsed.data.from, parsed.data.to);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/pdf",
      "X-Request-Id": requestId,
    },
  });
}
