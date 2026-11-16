# Primeiro contato de formulário

Fonte: pedido de Enedi de 16/11/2026 11:16. Escopo global, configuração por organização em Configurações > Organização, desligado quando ausente ou inválido. Horário padrão proposto: segunda a sexta, 9h às 18h, fuso da organização; horas e limite (1–3) editáveis. Não modifica regras de follow-up existentes.

Entrada: lead.created no event_log com origem verificável webhook_source_id. Consumidor formProactivityHandler registrado no drain existente. Saída: sendMessageHandler pelo recibo de atendimento original e sendEmail pela fachada existente. event_log.retry_at conserva esperas sem prender worker; uma fase por tick. Apenas eventos posteriores à ativação no servidor são elegíveis, sem disparar backlog.

Registros: form_proactivity_attempts contém claim único por org/lead/fase, resultado sem PII, e timestamps; trigger transacional insere notas na timeline existente. Lease iniciado e abandonado, resultado queued sem motivo conhecido ou timeout incerto não causam envio repetido: geram atenção para revisão humana. Falhas determinadas avançam WhatsApp -> correção/validação -> e-mail. Resposta inbound anterior, saída humana após formulário, opt-out, anonimização, mesclagem ou card encerrado interrompem; organização é relida antes de cada efeito. Recibo de atendimento e proteção da Agenda permanecem obrigatórios.

Correção de telefone aceita país/DDD, nono dígito e duplicações estruturais reconhecíveis. Não remove/insere dígito arbitrário de assinante para tentar desconhecidos. Canal valida existência antes da segunda tentativa; sem validação ou com ambiguidade, a fase falha e segue para e-mail. Canal sem verificação de telefone não fabrica resultado de existência. Original de correção validada fica no metadata do contato, sem exposição em logs.

Falha final: fn_form_proactivity_attention agrega tag atomicamente, sem sobrescrever tags concorrentes; KanbanCard mostra etiqueta vermelha independentemente de canonical_tags do pipeline. Etapa/status nunca são alterados. Porta existente /app/settings/tenant configura canal da própria organização, mensagens e horário. Mapa: evento -> handler -> mensagens/e-mail; handler -> tentativa -> timeline; falha -> tag -> card; formulário de configuração -> org.settings -> handler. Anti-morte: retry durável no evento; limite/falha incerta termina em atenção humana. Continuidade: lead que responde encerra primeiro contato, conservando atendimento existente.

Textos padrão propostos, editáveis:
- WhatsApp: Olá! Recebemos seu contato pelo formulário. Como podemos ajudar? Se preferir não receber mensagens, é só avisar.
- Assunto: Seu contato pelo formulário
- E-mail: Olá! Recebemos seu contato pelo formulário e não conseguimos falar com você pelo WhatsApp. Como podemos ajudar? Você pode responder a este e-mail. Se preferir não receber mensagens, é só avisar.

Testes usam transporte simulado e dados sintéticos. Nenhum envio real, teste pago, configuração ou follow-up de produção modificado. No canal que exige template fora da janela, a guarda de envio continua soberana: falha não contorna restrição; pode levar ao e-mail.

Um queued com motivo canônico de canal não configurado é falha sem transmissão: avança para validação e e-mail. Não é confundido com entrega incerta. Regressões simulam os dois casos.
