---
impacto: exige_acao
secao: adicionado
titulo: Dashboard nativo de tráfego com dados do Windsor
---

A tela de Relatório agora pode mostrar dados de Meta Ads e Google Ads sem iframe.
O administrador da plataforma escolhe, por organização, as contas e os campos de
conversão autorizados. Os dados são sincronizados para o banco da instalação,
deduplicados e exibidos por moeda, plataforma, campanha, conjunto e anúncio.

Para ativar, o operador mantém `WINDSOR_API_KEY` no ambiente da aplicação, aplica
a migration, escolhe as contas em Admin > Organizações > Tráfego e executa a
primeira sincronização. Organizações sem configuração continuam usando o relatório
externo anterior, quando houver.

## Requer atenção

Depois do deploy, aplique a migration 0246, confirme `WINDSOR_API_KEY` no ambiente,
escolha as contas autorizadas de cada organização e execute a primeira
sincronização manual. Sem essa configuração, nenhuma organização é ativada
automaticamente e o relatório anterior continua valendo.
