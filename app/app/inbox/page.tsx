import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { InboxLayout } from "@/components/inbox/InboxLayout";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; conversation?: string; message?: string }>;
}) {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) {
    const idioma = user.idioma;
    // As duas saídas que a frase anterior oferecia — "aceite um convite" e
    // "contate o admin" — não existem para quem INSTALOU o sistema: não há
    // convite e o admin é ele. Este é o estado terminal do primeiro acesso que
    // falhou, e o link é a única porta para fora dele.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
        <p>
          {traduzir(
            "Você não tem nenhuma organização ativa. Configure sua organização ou aceite um convite.",
            idioma,
          )}
        </p>
        <Link className="text-primary underline underline-offset-4" href="/get-started">
          {traduzir("Configurar minha organização", idioma)}
        </Link>
      </div>
    );
  }
  const { id, conversation, message } = await searchParams;
  // Decisão do dono (19/09/2026): o Inbox saiu do menu e deixa de ser a tela
  // inicial. Todo pouso que caía aqui (login, troca de organização, fim do
  // onboarding, fim do acompanhamento) vai para o quadro dos Funis. O Inbox
  // só abre por link direto a uma conversa (Radar, execução de agente).
  if (!id && !conversation && !message) redirect("/app/kanban");
  return <InboxLayout initialSelectedId={id ?? conversation ?? null} />;
}
