# Follow-up por silêncio

CONFIRMADO: ausente/inválido significa desligado em `organizations.settings.proactive_followup`, para qualquer organização, sem IDs especiais. Administrador configura em Distribuição de atendimento. Dias úteis, 09–18h em America/Sao_Paulo e duas tentativas são valores iniciais editáveis, não uma promessa comercial. Só ponteiros de silêncio publicados e habilitados pelo agente participam. A origem `automatic_silence` acompanha matrícula e job; checagens antes do transporte e do envio inline releem a opção, o horário, a última resposta e o limite. Matrículas anteriores/agendamentos explícitos não ganham essa origem por backfill.

Limite conservador: a seleção conta matrículas desde o último inbound e o sink conta saídas desde essa resposta (inclusive humanas). Não há envio fora de 24h, mesmo em canal que permita. Falha na leitura interrompe o efeito. Opt-out, autorização do canal, fronteira do atendimento e agenda continuam na cadeia existente.

Living System Checklist: entrada = cron existente `followup-flow-worker`; saída = matrícula → job → cadeia de envio; registro = eventos e timeline de follow-up existentes; tela = Fluxos/atividade e formulário de Distribuição; porta = Configurações já registrada; anti-morte = tick persistente e limites de retry; configuração = opção por org visível e desligada; continuidade = guardas de atribuição/handoff existentes; retorno = resposta do contato interrompe/reclassifica o fluxo e tentativas esgotadas impedem novo contato automático; mapa = mesmo motor, nova origem explícita na aresta de matrícula para envio.

Não medido: ativação em produção, envio real, efeitos em clientes reais. Nenhuma organização foi ativada nesta sessão.
