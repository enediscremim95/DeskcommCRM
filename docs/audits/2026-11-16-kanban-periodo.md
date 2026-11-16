# Período do Kanban

CONFIRMADO: `FilterBar` alimenta URL, `useBoard` inclui o período na chave de cache e em toda paginação; a rota filtra e conta no banco por `organization_id`. De/Até são dias em America/Sao_Paulo, com Até inclusivo convertido em limite exclusivo no dia seguinte. Atividade nula fica fora do período.

Living System Checklist: entrada = seleção e URL; saída = consulta e contagens do board; registro = URL compartilhável (leitura pura, sem auditoria de mutação); tela e porta = filtro no Kanban existente; anti-morte = sem efeito automático, realtime reconcilia filtros; configuração = campo, De e Até; continuidade = sem alteração de comando IA/humano; retorno = erro de validação para datas inválidas e regressões de borda; mapa = caminho existente FilterBar → useBoard → board API, sem novo componente de domínio.
