# Primeiro contato após formulário

CONFIRMADO: consumidor `captureProactivityHandler` de `lead.created`, para `source=webhook` e contato sem inbound, em todas as organizações por configuração genérica. Ausência/config inválida significa desligado. Administrador escolhe canal, texto e horário em Configurações → Distribuição de atendimento. A sequência aguarda pelo menos 60s, aplica throttle e guardas existentes, respeita dias úteis e não inicia contatos de eventos com mais de 72h.

WhatsApp: “Olá! Recebemos seu formulário e estamos entrando em contato para entender como podemos ajudar. Podemos conversar por aqui?”

E-mail, assunto “Sobre o seu formulário”: “Olá! Recebemos seu formulário e não conseguimos falar com você pelo WhatsApp. Se quiser continuar, responda este e-mail ou informe o melhor número para contato.”

Até duas tentativas WhatsApp e uma de e-mail. A correção automática se limita à variante equivalente do nono dígito; inserir/remover dígito arbitrário pode atingir outra pessoa e vira revisão. Não altera telefone cadastrado. Mensagem queued/pending aguarda resultado e não dispara e-mail. Resultado incerto exige revisão. Canais oficiais continuam sujeitos ao gate de janela/template existente; não há bypass para iniciar mensagem livre fora da janela.

E-mail comercial NÃO usa chave/remetente global. Cada organização usa seu `.env` dedicado na instalação, `<uuid-da-org>.env`, com `RESEND_API_KEY` e `FROM_EMAIL`, diretório `/etc/crm/org-email` ou `PROACTIVITY_EMAIL_ENV_DIR`. Arquivos não são versionados e não foram criados no box. Sem configuração da própria empresa, o efeito falha e chega à tag de atenção. Não colocar segredos no JSON da organização, PR ou Markdown.

Living System Checklist: entrada = lead.created; saída = ação canônica WhatsApp/e-mail por org; registro = crm_lead_activities, source_module=capture.proactivity; tela = timeline e etiqueta vermelha no Kanban; porta = Configurações → Distribuição; anti-morte = retry persistente no event_log, teto de idade e fallback; configuração = opt-in e mensagens editáveis; continuidade = resposta ou atuação humana interrompe antes do próximo toque, resultado incerto aponta revisão; retorno = humano corrige cadastro/política e decide nova abordagem, sem replay automático de envio incerto; mapa = capture-proactivity.architecture.json.

Não medido: configuração real de remetentes, entrega real ou dados de produção. Nenhuma org ativada, mensagem ou e-mail real enviados nesta sessão.
