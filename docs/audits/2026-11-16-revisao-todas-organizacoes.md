# Revisão das correções em todas as organizações

CONFIRMADO por código e regressão: a página de Relatório consulta a configuração nativa habilitada pela organização ativa. Configuração nativa válida permite a tela mesmo sem a permissão externa legada, conforme PR #231. O header x-report-organization só recusa troca de tenant entre abas; não concede autorização. Novos testes usam três organizações sem exceções por ID.

CONFIRMADO: a trava do Kanban verifica tipo do ator e o trigger verifica role de serviço, sem lista de organizações ou bypass por nicho. A organização não pode desligar a regra. Esta revisão depende da branch P1, que é a base deste PR; não aplica migrations na produção.

Não medido: quantidade de configs existentes, habilitadas ou ausentes na produção. `05-reports-all-organizations.sql` em `/workspace/crm-dev/vps-scripts/` prepara a leitura agregada para executar exclusivamente na VPS. Nenhuma configuração de organização foi alterada nesta sessão.

Living System Checklist: entrada = configuração da org ativa e requisição humana/automática; saída = relatório correto e funil preservado; registro = testes de regressão, auditoria de movimento já existente e SQL somente leitura preparado; tela/porta = Relatório e Kanban já registrados; anti-morte = bloqueio explícito de troca de tenant e de movimento automático; configuração = relatório por org e regra global humana; continuidade = fluxo humano preservado; retorno = falha em regressão impede publicar mudança que introduza exceção; mapa = caminhos existentes, nenhuma peça nova de produção.
