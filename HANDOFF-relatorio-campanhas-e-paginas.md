# HANDOFF: PDF do relatório mostra o que está rodando (campanhas ativas e páginas em teste)

**Pedido do dono (21/09/2026, 17:04),** sobre o PDF "Baixar relatório" (`lib/windsor/traffic-summary-pdf.tsx`,
rota `app/api/v1/reports/traffic/pdf`):
"seria bom também nesse relatório colocar quantas campanhas estamos rodando, quantas LPs estamos testando,
é possível o próprio relatório conseguir fazer essa leitura? ou deixar algo como: hoje temos 5 campanhas
ativas e os nomes das campanhas, embaixo? preciso usar esse relatório para apresentar o que está sendo feito."

## Medido por Claude (21/09/2026, v1.6.0-veritas.35)

- O sync do Relatório (`lib/windsor/*`) NÃO puxa status de campanha nem endereço da página de destino.
- Campos existentes no Windsor, conferidos pelo `get_fields` completo (não chute outros nomes):
  - **Meta (`facebook`):** status `campaign_effective_status` (e `campaign_status`, `adset_effective_status`,
    `effective_status` do anúncio); página `website_destination_url` (vem com parâmetros dinâmicos/UTM),
    `link`, `link_url`, `object_url`; `url_tags` = UTMs.
  - **Google Ads (`google_ads`):** status `campaign_status`, `serving_status`; página `ad_final_urls` /
    `ad_group_ad_ad_final_urls`, `final_url`, `expanded_final_url`.
- A tela de 14 dashboards já sincroniza por conta (sync por conta, detalhe de anúncio de 30 dias para contas
  grandes: v13/v18). Não reintroduza pedido único gigante ao Windsor, que travava (>15 min).

## O que precisa (você decide a arquitetura)

1. O **PDF** ganha, embaixo do funil, um bloco simples do que está sendo feito, por organização:
   - "Hoje: N campanhas ativas" + a lista com o **nome de cada campanha** (e de qual plataforma, Meta/Google).
     "Ativa" = status efetivo ativo na última sincronização; se o status não estiver disponível para uma
     conta, use "teve investimento no período" e não misture as duas réguas sem dizer qual é qual no código.
   - "N páginas em teste" + a lista das páginas (endereço **limpo**: domínio + caminho, sem UTM/parâmetro,
     deduplicado), vindas dos anúncios ativos/com investimento no período.
2. Macro e simples: **nenhuma nota explicativa nem rodapé de metodologia** (o dono proibiu). Só o título
   curto, os números e as listas. Lista longa: limite sensato (ex.: 10) com "e mais N".
3. Os mesmos dados podem aparecer na tela do Relatório se ficar natural, mas o pedido é o PDF.
4. Vale para todas as organizações; isolado por organização; quem só vê (viewer) baixa o PDF normalmente.
5. Se precisar guardar status/URL no banco: tripla de migration (migration + apêndice idempotente no
   `baseline.sql` + MANIFEST), RLS com `organization_id in (select public.fn_user_org_ids())` (a forma
   `= any(...)` é recusada pelo Postgres) e os dois `revoke` em função nova de `public`.
6. Conferir o PDF gerando uma amostra em ambiente node (no vitest use `// @vitest-environment node` na
   primeira linha do teste temporário; em jsdom a página sai em branco) e olhando a imagem da página.

Regras da casa: doutrina em `CLAUDE.md`, Zod, sem `console.log`, fragmento em `.changes/`, testes do recorte
verdes, `pnpm typecheck` e `pnpm lint` zerados. **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
