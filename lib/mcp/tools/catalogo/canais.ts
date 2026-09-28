import { declararTools } from "./tipos";

export const TOOLS_CANAIS = declararTools([
  {
    name: "crm_set_channel_automatic_attendance",
    category: "write",
    rotulo: "Ligar ou desligar respostas automáticas",
    explicacao:
      "Define se um número pode responder clientes sozinho. Desligado, tudo continua entrando no CRM, mas nenhuma resposta automática sai.",
    oQueToca: "Atendimento do número",
    risco: "critico",
    pacotes: ["atender"],
    // O agente publicado não pode autorizar a própria fala. Um cliente MCP
    // administrativo só alcança a tool com papel manager e escopo mcp:write.
    apenasHumano: true,
  },
]);
