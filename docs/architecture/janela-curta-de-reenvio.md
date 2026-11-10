# Janela curta de reenvio

Uma mensagem de WhatsApp, ou um novo envio de formulário, entra no negócio que o contato já tem aberto no mesmo funil. Não há prazo: horas ou dias depois continua sendo o mesmo pedido enquanto o card não foi encerrado. A junção automática de 2 minutos segue como rede para o par que nasce quase junto, antes de qualquer uma das duas entradas enxergar a outra.

Negócio novo de propósito não passa por essa regra. A pessoa cria o card na tela, pela API ou pela ferramenta do agente. Um negócio encerrado (ganho ou perdido) também libera o próximo. Um negócio aberto em outro funil não bloqueia o card do funil desta entrada.

A trava de `reentry_guard` não decide mais esse reaproveitamento. Ela só segura a corrida em que dois primeiros cards nascem no mesmo instante: o índice deixa um vencer e o outro alimenta o vencedor. O prazo padrão continua 60 minutos, afinável em Configurações da empresa, e a opção da fonte "Segurar envios que chegam juntos" liga essa trava para o formulário. Desligada, dois envios simultâneos ainda podem abrir dois cards; um negócio que já está aberto recebe o envio nos dois casos.

O card do formulário não carrega a chave `canal:inbound`. Por isso a trava antiga, lida só nessa chave, deixava o WhatsApp seguinte abrir outro negócio depois que a junção absorvia o card vazio.

## Living System Checklist

Living System Checklist, janela curta de reenvio

- [x] Quem me alimenta? `app/api/v1/webhooks/in/[token]/route.ts` e `lib/leads/nascimento-do-lead.ts`, depois que ambos resolveram um `contact_id` da organização.
- [x] Quem eu alimento? O negócio aberto do mesmo contato no mesmo funil, em `crm_leads`, seja ele de formulário ou de WhatsApp. A trava da corrida, quando não há card ainda, alimenta o vencedor do índice.
- [x] Que atividade/log eu emito? `crm_lead_activities.type = lead_merged`, pelo `emitLeadActivity`; a captação também permanece em `webhook_lead_captures` com desfecho `duplicado`. Nenhum `lead.lost` é emitido.
- [x] Onde eu apareço na tela? A atividade usa `activity-vocabulary` e aparece na timeline real da tela do lead e do painel lateral do CRM.
- [x] Por qual porta se chega até mim? O resultado operacional fica no Kanban e na tela do lead; o opt-in fica em `/app/webhooks`, no diálogo de criação e no detalhe da fonte, e o prazo fica em `/app/settings/tenant`.
- [x] Qual meu mecanismo anti-morte? O card sobrevivente continua aberto e a atividade `lead_merged` atualiza `last_activity_at`; nenhum card é encerrado artificialmente.
- [x] Onde se configura o que eu uso? O reaproveitamento do negócio aberto não tem interruptor: é a regra da entrada automática. A opção “Segurar envios que chegam juntos”, em `/app/webhooks`, liga só a trava da corrida. O prazo dessa trava fica em Configurações da empresa e degrada para 60 minutos se for legado ou inválido.
- [x] Qual a continuidade IA para humano? A IA e a pessoa continuam vendo o mesmo card e a timeline explica que a entrada foi juntada; não há handoff novo nesta peça.
- [x] Qual meu laço de retorno? A timeline mostra `lead_merged`. Encerrar o negócio muda a decisão seguinte: a próxima mensagem ou o próximo formulário abre um card novo. Se a entrada era outro pedido de propósito, a pessoa cria esse card na tela, pela API ou pela ferramenta do agente.
- [x] Atualizei o mapa vivo? `docs/architecture/crm-vivo.architecture.json` contém o nó da janela e três arestas concretas.
