import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { marcaDaSaida } from "@/lib/branding/saida";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderTrafficSummarySlides } from "@/lib/windsor/traffic-summary-slides";
import type { TrafficSummarySource } from "@/lib/windsor/traffic-summary-pdf";

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
};

function filenamePart(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "organizacao";
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

  // A rota canônica é a única dona da autorização, do tenant e da agregação.
  // `pdf_detail=1` inclui o mesmo detalhe já usado pelo PDF, sem duplicar a régua.
  const reportUrl = new URL(request.url);
  reportUrl.pathname = "/api/v1/reports/traffic";
  reportUrl.searchParams.set("pdf_detail", "1");
  const reportResponse = await getTrafficReport(
    new NextRequest(reportUrl, { headers: request.headers }),
  );
  if (!reportResponse.ok) return reportResponse;

  const envelope = (await reportResponse.json()) as TrafficReportEnvelope;
  if (!envelope.data) {
    return fail("internal_error", "Não foi possível montar o relatório.", 500, { requestId });
  }

  // O service role só lê a organização já resolvida pela sessão na rota canônica.
  const { data: organization, error: organizationError } = await createAdminClient()
    .from("organizations")
    .select("slug")
    .eq("id", envelope.data.organization_key)
    .maybeSingle();
  if (organizationError) {
    return fail("internal_error", "Não foi possível identificar a organização.", 500, {
      requestId,
    });
  }

  const brand = await marcaDaSaida(envelope.data.organization_key);
  const html = await renderTrafficSummarySlides({
    source: envelope.data,
    brand,
    language: parsed.data.language,
    organizationSlug: organization?.slug ?? null,
  });
  const organizationName = envelope.data.organization_name?.trim() || brand.nome;
  const filename = `relatorio-${filenamePart(organizationName)}-${parsed.data.from}-a-${parsed.data.to}.html`;

  return new Response(html, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/html; charset=utf-8",
      "X-Request-Id": requestId,
    },
  });
}
