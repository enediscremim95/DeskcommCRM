# Dashboard nativo de mídia via Windsor

## Decisão

O Windsor é uma integração da instalação, configurada somente por `WINDSOR_API_KEY` no ambiente. Cada organização recebe uma configuração própria, uma lista explícita de contas por `account_id` e um modelo de dashboard. A página do cliente lê apenas fatos persistidos no Postgres e nunca chama o Windsor.

O armazenamento usa quatro peças: configuração por organização, contas autorizadas, fatos diários granulares e execuções de sincronização. O cron busca cada conta no conector da sua plataforma com `select_accounts`, no máximo seis pedidos simultâneos, timeout de 75 segundos por pedido e prazo global de 450 segundos para iniciar novas consultas. Meta é lida em dois níveis: conjunto para KPIs exatos e anúncio para o drill com miniatura; o relatório usa o primeiro nos totais e o segundo somente na lista de anúncios, sem somar os dois. Cada resposta ainda é filtrada localmente pelo `account_id` e plataforma antes de deduplicar e normalizar. Cada rodada grava uma geração isolada; a configuração só aponta para essa geração depois que todas as contas da organização terminam. Uma falha parcial, portanto, nunca aparece misturada ao último conjunto confirmado.

## Fluxo

1. O platform admin abre a aba Tráfego da organização, carrega o catálogo do Windsor e escolhe contas, modelo e até dois campos de conversão.
2. Salvar a configuração emite auditoria e deixa o dashboard aguardando a primeira sincronização.
3. O cron da VPS busca até 90 dias por conta e plataforma, normaliza Meta e Google, rejeita respostas degradadas, persiste fatos e registra sucesso ou falha por organização.
4. A aba Relatório lê somente o banco. Sem configuração nativa, mantém o `report_url` atual.
5. O filtro de período consulta o banco no escopo da organização e devolve métricas separadas por moeda.

## Limites deliberados

- A chave Windsor nunca vai ao banco, browser ou log.
- Moedas diferentes nunca são somadas.
- Vendas do CRM só entram quando houver um instante de fechamento confiável no histórico. Não será usado `updated_at` como aproximação.
- Frequência só será exibida quando existir alcance agregado do período; somar alcance granular seria matematicamente falso.
- A configuração é responsabilidade do platform admin porque uma única chave da instalação enxerga contas de várias organizações.

## Living System Checklist

1. Entrada: catálogo e métricas da Windsor, selecionados pelo platform admin.
2. Saída: dashboard em `/app/relatorio` e decisão operacional de mídia.
3. Registro: `traffic_dashboard_sync_runs` e `api_audit_log` nas mutações.
4. Tela: configuração na organização e estado da sincronização no relatório.
5. Porta: aba Tráfego do tenant no admin e Relatório na navegação existente.
6. Anti-morte: cron periódico, status visível e sincronização manual inicial.
7. Configuração: contas, modelo e campos de conversão na aba Tráfego.
8. Continuidade: não aplicável a handoff IA/humano; é leitura operacional.
9. Retorno: falha preserva o último conjunto bom, marca erro e orienta nova sincronização.
10. Mapa: `docs/architecture/dashboard-nativo-windsor.architecture.json`.
