import { WHATSAPP_EXTENSION_ORIGIN } from "./constants";

const HEADERS = "Authorization, Content-Type, X-Extension-Id, X-CRM-Origin";

export function origemDaExtensaoPermitida(req: Request): boolean {
  return req.headers.get("origin") === WHATSAPP_EXTENSION_ORIGIN;
}

export function headersCorsDaExtensao(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": WHATSAPP_EXTENSION_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": HEADERS,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function comCorsDaExtensao(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(headersCorsDaExtensao()))
    headers.set(key, String(value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function respostaPreflightDaExtensao(req: Request): Response {
  if (!origemDaExtensaoPermitida(req)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: headersCorsDaExtensao() });
}
