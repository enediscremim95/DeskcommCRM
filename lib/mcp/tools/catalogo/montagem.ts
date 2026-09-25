import { declararTools } from "./tipos";

export const TOOLS_MONTAGEM = declararTools([
  {
    name: "crm_list_ai_agents",
    category: "read",
    rotulo: "Listar assistentes de IA",
    explicacao:
      "Mostra os assistentes da organização, o objetivo, o que está publicado, as skills e o roteador que chega até cada um.",
    oQueToca: "Configuração dos assistentes",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_get_ai_agent_prompt",
    category: "read",
    rotulo: "Ver instruções em vigor",
    explicacao:
      "Mostra somente as instruções da versão publicada de um assistente, sem devolver chave, token ou credencial.",
    oQueToca: "Configuração dos assistentes",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_create_ai_agent_draft_from_template",
    category: "write",
    rotulo: "Montar assistente por nicho",
    explicacao:
      "Cria um assistente a partir de um modelo de nicho, sempre desligado e em rascunho para uma pessoa revisar.",
    oQueToca: "Configuração dos assistentes",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_update_ai_agent_draft",
    category: "write",
    rotulo: "Ajustar rascunho do atendimento",
    explicacao:
      "Cria uma nova versão em rascunho para ajustar prompt, skills, passagem para humano e proteção do canal.",
    oQueToca: "Configuração dos assistentes e do canal",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_add_ai_agent_knowledge_draft",
    category: "write",
    rotulo: "Adicionar material ao rascunho",
    explicacao:
      "Guarda um texto ou site no acervo e cria um novo rascunho que propõe esse material para o assistente.",
    oQueToca: "Base de conhecimento do assistente",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
]);
