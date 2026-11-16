# Agenda com reunião sem depender do Google

## Regra confirmada

O CRM gera uma sala Jitsi própria já ao marcar um compromisso online, sem depender de consulta ao Google. A regra de confirmação do tipo de agendamento é preservada. Quando a conexão do responsável está saudável e existe exatamente uma agenda de destino gravável, o worker também publica o evento no Google com o mesmo link; uma falha externa não desfaz o compromisso local.

Um tipo `video_link` respeita a URL cadastrada. Se não houver URL cadastrada, recebe a mesma alternativa Jitsi.

A Agenda testa o token por uma leitura autenticada no Google antes de exibir uma conexão saudável. Falha de rede ou credencial indecifrável não é declarada saudável. A recuperação posterior do Google não substitui uma sala Jitsi já pronta. Uma resposta `401` ou `invalid_grant` expira a conexão, abre aviso na Central e pede reconexão na Agenda.

O convite `.ics` da alternativa Jitsi é enviado ao responsável e ao cliente, em mensagens separadas. O `guest_email` explícito prevalece sobre `contacts.email`; sem e-mail válido, o agendamento continua confirmado e o link permanece disponível na Agenda. A chave por agendamento, papel e destinatário é usada pelo Resend para idempotência. O transporte SES não garante idempotência: repetir uma falha parcial pode duplicar uma entrega já aceita. Os testes usam exclusivamente mocks, sem e-mail real.
