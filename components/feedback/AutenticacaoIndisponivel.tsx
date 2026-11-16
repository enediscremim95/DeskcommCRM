"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MENSAGEM_AUTH_INDISPONIVEL } from "@/lib/auth/auth-indisponivel";

/**
 * A autenticação não respondeu a tempo. Sem sessão perdida: a pessoa só precisa
 * tentar de novo. Fica fora do `AuthProvider`/`useT` de propósito — o layout que
 * a renderiza não conseguiu nem resolver o usuário (e portanto o idioma).
 */
export function AutenticacaoIndisponivel() {
  const router = useRouter();
  const [tentando, setTentando] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center p-8" data-testid="autenticacao-indisponivel">
      <Card className="w-full max-w-md p-8 text-center">
        <p role="alert" className="text-base font-medium">{MENSAGEM_AUTH_INDISPONIVEL}</p>
        <Button
          type="button"
          className="mt-4"
          disabled={tentando}
          onClick={() => { setTentando(true); router.refresh(); setTimeout(() => setTentando(false), 3_000); }}
        >
          Tentar de novo
        </Button>
      </Card>
    </main>
  );
}
