# Janela curta de reenvio

O CRM preserva vários negócios abertos para a mesma pessoa. A exceção é uma entrada automática recebida pouco depois da criação do card: ela alimenta o negócio recém-criado porque os dados de produção mostram que esse bloco curto reúne reenvio da origem e corrida de ingestão, não uma demanda separada.

O padrão é 60 minutos. Esse é o primeiro limite medido que separa o bloco curto: 31 pares ocorreram abaixo de 1 minuto e mais 32 entre 1 minuto e 1 hora. O padrão cobre esses 63 pares e para antes dos 56 observados acima de 1 hora. Cada organização pode mudar o valor em Configurações da empresa.

## Living System Checklist

Living System Checklist, janela curta de reenvio

- [x] Quem me alimenta? `app/api/v1/webhooks/in/[token]/route.ts` e `lib/leads/nascimento-do-lead.ts`, depois que ambos resolveram um `contact_id` da organização.
- [x] Quem eu alimento? O card sobrevivente em `crm_leads`, com `custom_fields`, `source_metadata` e tags da entrada posterior; depois da janela, `crm_leads` recebe um novo card.
- [x] Que atividade/log eu emito? `crm_lead_activities.type = lead_merged`, pelo `emitLeadActivity`; a captação também permanece em `webhook_lead_captures` com desfecho `duplicado`. Nenhum `lead.lost` é emitido.
- [x] Onde eu apareço na tela? A atividade usa `activity-vocabulary` e aparece na timeline real da tela do lead e do painel lateral do CRM.
- [x] Por qual porta se chega até mim? O resultado operacional fica no Kanban e na tela do lead; o knob fica na rota já registrada `/app/settings/tenant`.
- [x] Qual meu mecanismo anti-morte? O card sobrevivente continua aberto e a atividade `lead_merged` atualiza `last_activity_at`; nenhum card é encerrado artificialmente.
- [x] Onde se configura o que eu uso? `Configurações > Organização`, campo “Janela para juntar reenvios”; ausência ou valor legado inválido degrada para 60 minutos.
- [x] Qual a continuidade IA para humano? A IA e a pessoa continuam vendo o mesmo card e a timeline explica que a entrada foi juntada; não há handoff novo nesta peça.
- [x] Qual meu laço de retorno? O operador observa `lead_merged` na timeline e ajusta a janela da organização; as próximas entradas leem esse valor antes de decidir.
- [x] Atualizei o mapa vivo? `docs/architecture/crm-vivo.architecture.json` contém o nó da janela e três arestas concretas.
