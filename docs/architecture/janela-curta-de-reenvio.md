# Janela curta de reenvio

O CRM preserva vários negócios abertos para a mesma pessoa quando eles pertencem a funis diferentes. No WhatsApp, uma mensagem alimenta o negócio aberto mais recente do contato no funil de entrada, sem mover etapa, posição ou status. Ganhar ou perder esse negócio libera uma nova demanda. Uma fonte de webhook só alimenta o card recém-criado quando quem a configurou declarou que a ferramenta costuma repetir o mesmo envio.

O WhatsApp não tem uma `webhook_source`. A janela curta continua protegendo a corrida de 0,1 segundo medida nesse canal. Depois da janela, o negócio aberto no funil de entrada continua sendo a demanda viva, inclusive se nasceu por formulário. `organizations.settings.lead_reentry_reuse_open = false` devolve o comportamento anterior; ausente significa ligado.

Quando a proteção está ligada, o prazo padrão é 60 minutos. Esse é o primeiro limite medido que separa o bloco curto: 31 pares ocorreram abaixo de 1 minuto e mais 32 entre 1 minuto e 1 hora. A organização pode mudar o prazo em Configurações da empresa.

## Living System Checklist

Living System Checklist, janela curta de reenvio

- [x] Quem me alimenta? `app/api/v1/webhooks/in/[token]/route.ts` e `lib/leads/nascimento-do-lead.ts`, depois que ambos resolveram um `contact_id` da organização.
- [x] Quem eu alimento? O card sobrevivente em `crm_leads`; no WhatsApp, primeiro pela janela curta e depois pelo negócio aberto no funil de entrada. Fontes de webhook seguem a opção própria.
- [x] Que atividade/log eu emito? `crm_lead_activities.type = lead_merged`, pelo `emitLeadActivity`; a captação também permanece em `webhook_lead_captures` com desfecho `duplicado`. Nenhum `lead.lost` é emitido.
- [x] Onde eu apareço na tela? A atividade usa `activity-vocabulary` e aparece na timeline real da tela do lead e do painel lateral do CRM.
- [x] Por qual porta se chega até mim? O resultado operacional fica no Kanban e na tela do lead; o opt-in fica em `/app/webhooks`, no diálogo de criação e no detalhe da fonte, e o prazo fica em `/app/settings/tenant`.
- [x] Qual meu mecanismo anti-morte? O card sobrevivente continua aberto e a atividade `lead_merged` atualiza `last_activity_at`; nenhum card é encerrado artificialmente.
- [x] Onde se configura o que eu uso? Em `Conectar uma página`, pela opção “Esta origem pode repetir o mesmo envio”, e em Configurações da empresa, pelo botão “Manter respostas no negócio aberto”. O prazo fica na mesma tela e degrada para 60 minutos se for legado ou inválido.
- [x] Qual a continuidade IA para humano? A IA e a pessoa continuam vendo o mesmo card e a timeline explica que a entrada foi juntada; não há handoff novo nesta peça.
- [x] Qual meu laço de retorno? O operador observa `lead_merged` na timeline, pode desligar a opção naquela fonte e ajustar o prazo; as próximas entradas leem os dois valores antes de decidir.
- [x] Atualizei o mapa vivo? `docs/architecture/crm-vivo.architecture.json` contém o nó da janela e três arestas concretas.
