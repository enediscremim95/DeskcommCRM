# Continuidade inbound e janela curta de reenvio

O CRM preserva vários negócios abertos para a mesma pessoa. Não há sinal no payload que separe um reenvio técnico de uma nova conversão: essa decisão pertence à fonte. Uma fonte de webhook só alimenta o card recém-criado quando quem a configurou declarou que a ferramenta costuma repetir o mesmo envio. O padrão é desligado, portanto nenhuma fonte existente muda de comportamento em silêncio.

O canal inbound não tem uma `webhook_source`. Enquanto o card criado por essa entrada estiver aberto, toda nova mensagem do contato alimenta o mesmo card, independentemente de quanto tempo passou. A etapa atual é preservada. Quando o card está ganho ou perdido, a mensagem inicia uma oportunidade nova na etapa de entrada.

A trava de banco continua protegendo a primeira criação simultânea do canal, pois a corrida de 0,1 segundo foi medida ali. Ela usa uma chave própria por fonte e outra para o canal inbound, impedindo que uma origem absorva o card criado por outra.

Nas fontes de formulário que ativaram a proteção, o prazo padrão continua sendo 60 minutos. Esse é o primeiro limite medido que separa o bloco curto: 31 pares ocorreram abaixo de 1 minuto e mais 32 entre 1 minuto e 1 hora. A organização pode mudar o prazo em Configurações da empresa. O prazo não encerra nem duplica o card inbound.

## Living System Checklist

Living System Checklist, continuidade inbound e janela curta de reenvio

- [x] Quem me alimenta? `app/api/v1/webhooks/in/[token]/route.ts` e `lib/leads/nascimento-do-lead.ts`, depois que ambos resolveram um `contact_id` da organização.
- [x] Quem eu alimento? O card sobrevivente em `crm_leads`; o canal alimenta seu card enquanto ele estiver aberto, a fonte marcada alimenta dentro do prazo, e fontes não marcadas criam um card por evento.
- [x] Que atividade/log eu emito? `crm_lead_activities.type = lead_merged`, pelo `emitLeadActivity`; a captação também permanece em `webhook_lead_captures` com desfecho `duplicado`. Nenhum `lead.lost` é emitido.
- [x] Onde eu apareço na tela? A atividade usa `activity-vocabulary` e aparece na timeline real da tela do lead e do painel lateral do CRM.
- [x] Por qual porta se chega até mim? O resultado operacional fica no Kanban e na tela do lead; o opt-in fica em `/app/webhooks`, no diálogo de criação e no detalhe da fonte, e o prazo fica em `/app/settings/tenant`.
- [x] Qual meu mecanismo anti-morte? O card sobrevivente continua aberto e a atividade `lead_merged` atualiza `last_activity_at`; nenhum card é encerrado artificialmente.
- [x] Onde se configura o que eu uso? Em `Conectar uma página`, pela opção “Esta origem pode repetir o mesmo envio”, também editável no detalhe da fonte. O padrão do banco é `false`. O prazo das fontes fica em Configurações da empresa e degrada para 60 minutos se for legado ou inválido. A continuidade do canal é regra global, não configuração oculta.
- [x] Qual a continuidade IA para humano? A IA e a pessoa continuam vendo o mesmo card e a timeline explica que a entrada foi juntada; não há handoff novo nesta peça.
- [x] Qual meu laço de retorno? O operador observa `lead_merged` na timeline. Nas fontes, pode desligar a opção e ajustar o prazo. No canal, fechar o card declara o desfecho e faz a próxima entrada nascer como oportunidade nova.
- [x] Atualizei o mapa vivo? `docs/architecture/crm-vivo.architecture.json` contém o nó da janela e três arestas concretas.
