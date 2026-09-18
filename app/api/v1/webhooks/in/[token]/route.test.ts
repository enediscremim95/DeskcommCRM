import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { OPTIONS, POST } from "@/app/api/v1/webhooks/in/[token]/route";

describe("CORS do webhook público de captação", () => {
  const signatureHeader = ["x", ["desk", "comm"].join(""), "signature"].join("-");

  it("responde o preflight sem consultar fonte ou tenant", () => {
    const response = OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      `Content-Type, ${signatureHeader}`,
    );
    expect(response.headers.get("access-control-expose-headers")).toBe("X-Request-Id");
  });

  it("inclui CORS também numa resposta de erro do POST", async () => {
    const request = new NextRequest("https://crm.example.com/api/v1/webhooks/in/curto", {
      method: "POST",
      headers: { origin: "https://lp.example.com", "content-type": "application/json" },
      body: JSON.stringify({ nome: "Ana" }),
    });

    const response = await POST(request, { params: Promise.resolve({ token: "curto" }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
