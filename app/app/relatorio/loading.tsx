/**
 * Resposta imediata ao clique em "Relatório".
 *
 * A página é `force-dynamic` e consulta a organização no servidor; sem um
 * `loading.tsx` a navegação ficava parada na tela anterior até o servidor
 * responder — e, com o servidor lento, o link parecia não reagir ao clique.
 */
export default function RelatorioCarregando() {
  return (
    <div className="flex h-full flex-col gap-5 p-6" role="status" aria-live="polite" data-testid="relatorio-carregando">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-80 animate-pulse rounded-md bg-muted" />
      <div className="min-h-[40vh] w-full animate-pulse rounded-md bg-muted/60" />
    </div>
  );
}
