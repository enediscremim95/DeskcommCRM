/**
 * OS TRÊS TEMPLATES — e por que três, e não sete.
 *
 * A lista de nichos que um revendedor atende é sempre maior que a lista de
 * JORNADAS de atendimento que eles têm. Odontologia, laboratório de análises e
 * consultório são três negócios diferentes e um único fluxo: alguém chama,
 * alguém qualifica, alguém marca horário. Loja de móveis e loja de roupa são
 * dois negócios e um fluxo: alguém pergunta o preço, alguém fecha a venda.
 *
 * Sete templates para vinte clientes significa manter sete configurações, cinco
 * das quais nenhum cliente usa — e configuração que ninguém usa é configuração
 * que ninguém corrige quando envelhece. Especializar é decisão barata de tomar
 * depois, quando dois ou três clientes reais mostrarem que o fluxo é mesmo
 * diferente. Generalizar depois de ter sete é caro.
 *
 * Loja e curso não ganham template próprio aqui porque o pacote de funil deles
 * já existe no onboarding e nenhum cliente da carteira pediu a cadência — o dia
 * em que pedir, entra como quarto template, não como remendo nos três.
 *
 * ⚠️ NENHUM texto abaixo pode nomear um cliente, uma cidade, um preço ou um
 * produto real. Um template é entregue a organizações diferentes; o que ele diz
 * vai aparecer na tela de todas elas.
 */
import { templateDeOrganizacaoSchema, type TemplateDeOrganizacao } from "./tipos";

const SERVICOS: TemplateDeOrganizacao = templateDeOrganizacaoSchema.parse({
  id: "servicos",
  nome: "Serviços e agência",
  paraQuem: "Agência, consultoria, obra, manutenção e prestação de serviço sob orçamento",
  pacoteDeFunil: "servicos",
  vocabulario: { lead: "Pedido", deal: "Orçamento", won: "Fechado", lost: "Não fechou" },
  campos: [
    { key: "servico_desejado", label: "Serviço que procura", type: "text" },
    { key: "prazo_desejado", label: "Para quando precisa", type: "text" },
    { key: "faixa_de_investimento", label: "Faixa de investimento", type: "text" },
    { key: "como_nos_achou", label: "Como nos achou", type: "text" },
  ],
  motivosDePerda: [
    "Achou caro",
    "Fechou com outro fornecedor",
    "Adiou o projeto",
    "Não era o serviço que a gente faz",
    "Parou de responder",
  ],
  tagsDeConversa: ["orcamento", "urgente", "fora-do-escopo", "indicacao", "reativacao"],
  respostasRapidas: [
    {
      titulo: "Primeira resposta",
      atalho: "oi",
      corpo:
        "Olá! Que bom falar com você. Para eu montar um orçamento que faça sentido, me conta rapidinho: o que você precisa e para quando?",
    },
    {
      titulo: "Pedir o que falta para orçar",
      atalho: "faltadado",
      corpo:
        "Obrigado pelas informações! Para fechar o orçamento ainda preciso de duas coisas: o prazo que você tem em mente e onde o serviço seria feito. Pode me mandar?",
    },
    {
      titulo: "Orçamento enviado",
      atalho: "orcado",
      corpo:
        "Acabei de te enviar o orçamento. Dá uma olhada com calma e me diz se ficou claro. Se preferir, eu explico cada item por aqui.",
    },
    {
      titulo: "Fora do que atendemos",
      atalho: "foraescopo",
      corpo:
        "Agradeço a procura! Esse serviço específico não é o que a gente faz, então prefiro ser honesto em vez de te prender numa proposta que não vai te atender bem.",
    },
  ],
  atendente: {
    nome: "Atendente",
    instrucoes: [
      "Você atende quem pede orçamento de serviço.",
      "",
      "Sua função é entender o pedido e passar para a equipe com as informações completas. Você não fecha preço, não dá desconto e não promete prazo.",
      "",
      "O que você precisa descobrir, em conversa, sem parecer formulário:",
      "1. Qual serviço a pessoa procura.",
      "2. Para quando ela precisa.",
      "3. Onde o serviço seria feito.",
      "4. Se ela já tem uma faixa de investimento em mente.",
      "",
      "Quando tiver essas respostas, diga que vai passar para a equipe montar o orçamento e informe que alguém volta com o valor.",
      "",
      "Se perguntarem preço antes de você ter o que precisa, explique em uma frase que o valor depende do que será feito, e faça a próxima pergunta.",
      "Se o pedido não for um serviço que a empresa faz, diga isso com clareza em vez de empurrar a conversa adiante.",
    ].join("\n"),
    regrasDaCasa: [
      "Nunca prometa preço, desconto ou prazo de entrega — quem fecha valor é a equipe.",
      "Nunca invente que a empresa faz um serviço; se não souber, diga que vai confirmar.",
      "Fale como a pessoa fala, sem jargão técnico.",
    ].join("\n"),
  },
  cadencias: [
    {
      nome: "Orçamento sem resposta",
      proposito: "Retomar quem recebeu o orçamento e não respondeu",
      passos: [
        {
          esperarMinutos: 2880,
          texto:
            "Oi! Passando para saber se o orçamento chegou direitinho e se ficou alguma dúvida.",
        },
        {
          esperarMinutos: 5760,
          texto:
            "Oi! Só para não te deixar sem resposta: o orçamento continua valendo. Se fizer sentido retomar, me chama.",
        },
      ],
    },
  ],
});

const IMOBILIARIA: TemplateDeOrganizacao = templateDeOrganizacaoSchema.parse({
  id: "imobiliaria",
  nome: "Imobiliária",
  paraQuem: "Imobiliária, corretor autônomo e lançamento de empreendimento",
  pacoteDeFunil: "imobiliaria",
  vocabulario: { lead: "Interessado", deal: "Negócio", won: "Fechou", lost: "Desistiu" },
  campos: [
    { key: "finalidade", label: "Quer comprar ou alugar", type: "select", options: [
      { value: "comprar", label: "Comprar" },
      { value: "alugar", label: "Alugar" },
    ] },
    { key: "tipo_de_imovel", label: "Tipo de imóvel", type: "select", options: [
      { value: "apartamento", label: "Apartamento" },
      { value: "casa", label: "Casa" },
      { value: "terreno", label: "Terreno" },
      { value: "comercial", label: "Comercial" },
      { value: "rural", label: "Rural" },
    ] },
    { key: "bairros_de_interesse", label: "Bairros de interesse", type: "text" },
    { key: "quartos", label: "Quartos", type: "number" },
    { key: "valor_maximo", label: "Valor máximo", type: "number" },
    { key: "forma_de_pagamento", label: "Forma de pagamento", type: "select", options: [
      { value: "financiamento", label: "Financiamento" },
      { value: "a_vista", label: "À vista" },
      { value: "fgts", label: "Usando FGTS" },
      { value: "consorcio", label: "Consórcio" },
      { value: "indefinido", label: "Ainda não sabe" },
    ] },
    { key: "imovel_de_interesse", label: "Imóvel que chamou atenção", type: "text" },
  ],
  motivosDePerda: [
    "Não achou o imóvel que queria",
    "Crédito não aprovado",
    "Fechou com outra imobiliária",
    "Adiou a mudança",
    "Valor acima do que pode pagar",
    "Parou de responder",
  ],
  tagsDeConversa: [
    "visita-agendada",
    "financiamento",
    "a-vista",
    "primeiro-imovel",
    "investidor",
    "locacao",
  ],
  respostasRapidas: [
    {
      titulo: "Primeira resposta",
      atalho: "oi",
      corpo:
        "Olá! Obrigado pelo interesse. Para eu te mostrar as opções certas, me conta: você procura para comprar ou alugar, e em que região?",
    },
    {
      titulo: "Qualificar o que procura",
      atalho: "perfil",
      corpo:
        "Perfeito! Mais três coisinhas e eu já separo as opções: quantos quartos você precisa, qual valor máximo cabe no seu planejamento, e se a compra seria financiada ou à vista.",
    },
    {
      titulo: "Convidar para visita",
      atalho: "visita",
      corpo:
        "Tenho opções que batem com o que você procura. Prefere visitar em dia de semana ou no fim de semana? Me diz o melhor período e eu organizo.",
    },
    {
      titulo: "Confirmar visita",
      atalho: "confirmavisita",
      corpo:
        "Visita confirmada! Vou te mandar o endereço e o horário. Se precisar remarcar, me avisa por aqui que a gente ajusta.",
    },
    {
      titulo: "Explicar documentação de financiamento",
      atalho: "documentos",
      corpo:
        "Para dar entrada no financiamento, o banco costuma pedir documento com foto, comprovante de renda e comprovante de residência. Assim que você tiver em mãos, a gente inicia a análise.",
    },
  ],
  atendente: {
    nome: "Atendente",
    instrucoes: [
      "Você atende quem procura imóvel.",
      "",
      "Sua função é entender o que a pessoa procura e levá-la a agendar uma visita com um corretor. Você não negocia valor, não garante aprovação de crédito e não reserva imóvel.",
      "",
      "O que você precisa descobrir, conversando:",
      "1. Comprar ou alugar.",
      "2. Região ou bairros de interesse.",
      "3. Tipo de imóvel e quantos quartos.",
      "4. Valor máximo que cabe no planejamento.",
      "5. Se a compra seria financiada, à vista, com FGTS ou consórcio.",
      "",
      "Com isso na mão, convide para visita e ofereça dois períodos de horário.",
      "",
      "Se a pessoa citar um imóvel específico, registre qual e continue descobrindo o resto — quem procura um anúncio normalmente aceita ver parecidos.",
      "Sobre financiamento, explique quais documentos o banco costuma pedir, mas nunca diga que o crédito está aprovado: isso é o banco que decide.",
    ].join("\n"),
    regrasDaCasa: [
      "Nunca garanta aprovação de crédito nem prometa taxa de financiamento.",
      "Nunca reserve ou prometa exclusividade de imóvel sem o corretor confirmar.",
      "Nunca invente característica de imóvel; se não souber, diga que vai confirmar.",
      "Valor anunciado é ponto de partida; negociação é com o corretor.",
    ].join("\n"),
  },
  cadencias: [
    {
      nome: "Interessado sem visita marcada",
      proposito: "Retomar quem demonstrou interesse e não marcou visita",
      passos: [
        {
          esperarMinutos: 1440,
          texto:
            "Oi! Separei algumas opções na região que você comentou. Quer que eu te mande, ou prefere já agendar uma visita?",
        },
        {
          esperarMinutos: 4320,
          texto:
            "Oi! Apareceu novidade na faixa que você procura. Se ainda estiver olhando, me chama que eu te mostro.",
        },
      ],
    },
    {
      nome: "Depois da visita",
      proposito: "Ouvir a impressão de quem visitou, antes de a memória esfriar",
      passos: [
        {
          esperarMinutos: 1440,
          texto:
            "Oi! O que você achou do imóvel que visitou? Sua opinião me ajuda a acertar a próxima indicação, inclusive o que não gostou.",
        },
      ],
    },
  ],
});

const CLINICA: TemplateDeOrganizacao = templateDeOrganizacaoSchema.parse({
  id: "clinica",
  nome: "Clínica e agenda",
  paraQuem: "Odontologia, laboratório, consultório, estética e qualquer negócio que marca horário",
  pacoteDeFunil: "clinica",
  vocabulario: { lead: "Paciente", deal: "Atendimento", won: "Agendado", lost: "Não agendou" },
  campos: [
    { key: "procedimento_de_interesse", label: "Procedimento de interesse", type: "text" },
    { key: "primeira_vez", label: "Primeira vez na clínica", type: "boolean" },
    { key: "convenio", label: "Convênio", type: "text" },
    { key: "preferencia_de_horario", label: "Preferência de horário", type: "select", options: [
      { value: "manha", label: "Manhã" },
      { value: "tarde", label: "Tarde" },
      { value: "noite", label: "Noite" },
      { value: "sabado", label: "Sábado" },
    ] },
    { key: "como_nos_achou", label: "Como nos achou", type: "text" },
  ],
  motivosDePerda: [
    "Achou caro",
    "Não tem o convênio que a gente atende",
    "Horário não encaixou",
    "Procurou outro lugar",
    "Só queria saber o preço",
    "Parou de responder",
  ],
  tagsDeConversa: [
    "primeira-consulta",
    "retorno",
    "convenio",
    "particular",
    "urgencia",
    "orcamento-enviado",
  ],
  respostasRapidas: [
    {
      titulo: "Primeira resposta",
      atalho: "oi",
      corpo:
        "Olá! Obrigado pelo contato. Para eu te orientar direito, me conta qual atendimento você procura e se já é paciente aqui.",
    },
    {
      titulo: "Oferecer horários",
      atalho: "horarios",
      corpo:
        "Consigo te encaixar esta semana. Você prefere manhã, tarde ou final do dia? Me diz o melhor período e eu reservo.",
    },
    {
      titulo: "Confirmar agendamento",
      atalho: "confirma",
      corpo:
        "Agendamento confirmado! Chegue com alguns minutos de antecedência e traga um documento com foto. Se precisar remarcar, me avisa por aqui.",
    },
    {
      titulo: "Preço antes da avaliação",
      atalho: "preco",
      corpo:
        "Entendo a pergunta. O valor depende do que o profissional encontrar na avaliação, então prefiro não te passar um número que pode mudar. A avaliação é rápida e você sai dela com o orçamento na mão.",
    },
    {
      titulo: "Lembrete de véspera",
      atalho: "lembrete",
      corpo:
        "Oi! Passando para lembrar do seu atendimento amanhã. Está tudo certo para você vir, ou prefere que eu remarque?",
    },
  ],
  atendente: {
    nome: "Atendente",
    instrucoes: [
      "Você atende quem procura a clínica.",
      "",
      "Sua função é entender o que a pessoa precisa e levá-la a marcar horário. Você não dá diagnóstico, não indica tratamento, não diz se um sintoma é grave e não passa preço de procedimento.",
      "",
      "O que você precisa descobrir, conversando:",
      "1. Qual atendimento a pessoa procura.",
      "2. Se já é paciente da casa.",
      "3. Se vai usar convênio ou é particular.",
      "4. Qual período do dia funciona melhor para ela.",
      "",
      "Com isso, ofereça dois períodos de horário e confirme o agendamento.",
      "",
      "Se perguntarem preço, explique em uma frase que o valor depende da avaliação do profissional e convide para a avaliação.",
      "Se a pessoa descrever sintoma, dor ou piora, não interprete e não tranquilize: registre o que ela disse e priorize o encaixe mais próximo.",
      "Se ela relatar algo que soe urgente, diga para procurar atendimento presencial imediatamente em vez de esperar resposta por mensagem.",
    ].join("\n"),
    regrasDaCasa: [
      "Nunca dê diagnóstico, nunca indique ou descarte tratamento, nunca diga se um sintoma é grave — isso é do profissional de saúde.",
      "Nunca passe preço de procedimento sem a avaliação.",
      "Nunca peça dado de saúde além do necessário para marcar o horário.",
      "Nunca repita dado de saúde de um paciente em conversa com outra pessoa.",
      "Diante de relato de urgência, oriente procurar atendimento presencial na hora.",
    ].join("\n"),
  },
  cadencias: [
    {
      nome: "Interessado que não marcou",
      proposito: "Retomar quem pediu informação e não agendou",
      passos: [
        {
          esperarMinutos: 1440,
          texto:
            "Oi! Vi que a gente não chegou a marcar seu horário. Ainda quer que eu veja um encaixe para você?",
        },
        {
          esperarMinutos: 7200,
          texto:
            "Oi! Se ainda fizer sentido, continuo à disposição para encaixar seu atendimento. Me chama que eu vejo a agenda.",
        },
      ],
    },
  ],
});

/**
 * O catálogo, na ordem em que a tela oferece.
 *
 * "Serviços e agência" primeiro porque é o que cobre mais casos da carteira —
 * quem não se reconhece nos outros dois normalmente se reconhece nele.
 */
export const TEMPLATES: readonly TemplateDeOrganizacao[] = [
  SERVICOS,
  IMOBILIARIA,
  CLINICA,
] as const;

/** Nunca devolve um template de id desconhecido — quem chama recebe `undefined` e decide. */
export function acharTemplate(id: string): TemplateDeOrganizacao | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
