# HANDOFF: o cliente ENXERGA por padrão (o fechado silencioso queimou o dono na frente do cliente)

## O que aconteceu hoje (24/09/2026), medido na produção
Cliente convidado para a organização `bendito-ponto` (papel `admin`, interface `completa`) clicou em
**Relatório** e foi redirecionado para `/403`. Não era dado faltando: `traffic_dashboard_configs` estava
`enabled` e sincronizado. A causa é `lib/integrations/access.ts` + `CLOSED_INTEGRATION_ACCESS`
(`lib/integrations/types.ts`): **sem linha em `organization_integration_permissions`, o padrão é FECHADO**,
e `app/app/relatorio/page.tsx` redireciona para `/403` quando `clientCanViewIntegration(..., "windsor")`
é falso.

Auditoria das 24 organizações: **só `sublimando` tinha a linha**. Ou seja, TODO cliente convidado até hoje
levava porta na cara ao abrir o Relatório, inclusive as 6 pessoas da `lumia-imobiliaria`. Já corrigi os
dados em produção (linhas criadas para as 24 organizações, as três integrações visíveis,
`client_can_reconnect` continua `false`). Falta consertar a CAUSA, que é este handoff.

## Decisão do dono (palavras dele): "libera tudo, isso não deve ser uma trava nunca"
1. **O padrão passa a ser VISÍVEL** para o cliente nas três integrações (`windsor`, `n8n`, `whatsapp`):
   ausência de linha em `organization_integration_permissions` significa "pode ver", não "não pode".
   Troque a constante e a leitura, mantendo a possibilidade de o dono FECHAR explicitamente (linha com
   `client_visible = false` continua valendo e tem precedência).
2. **Ação continua fechada por padrão.** `client_can_reconnect` (reconectar WhatsApp) permanece `false`
   por padrão: ver é uma coisa, mexer na sessão do número é outra.
3. **Organização nova nasce enxergando.** Onde a organização é criada (inclusive o caminho usado pelo
   script `Scripts/crm-veritas/criar-cliente.py`, fora deste repo, e o onboarding), garanta que o efeito
   seja o mesmo do item 1 sem depender de alguém lembrar de marcar algo.
4. **Dado inconsistente não pode virar porta na cara.** Se a organização tem relatório habilitado e a
   pessoa tem papel suficiente, a tela do Relatório NÃO redireciona para `/403`. Se faltar configuração,
   mostre a tela com uma frase dizendo o que falta, em português simples, em vez de expulsar.
5. **`report_url` que aponta para página inexistente** não pode virar botão morto: com o relatório nativo
   ligado, o link externo não aparece. (Hoje já é assim no componente; confirme e cubra com teste.)

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Migration só se precisar (o comportamento vive em código); se houver, tripla completa
  (migration + apêndice idempotente no `baseline.sql` + MANIFEST) e RLS no formato
  `organization_id in (select public.fn_user_org_ids())`.
- Textos com `t()` e espanhol. Sem travessão "—" em texto visível.
- Testes que provam: sem linha nenhuma o cliente VÊ; linha com `client_visible=false` ESCONDE; reconectar
  WhatsApp continua fechado por padrão; organização nova enxerga; Relatório não manda para `/403` quando a
  organização tem relatório habilitado.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes. Fragmento em `.changes/`.
  `git fetch` + merge da `origin/main` antes do commit. Commit na branch atual
  (`fix/cliente-ve-por-padrao`), sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
