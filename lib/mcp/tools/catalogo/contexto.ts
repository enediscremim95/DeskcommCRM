import { declararTools } from "./tipos";

export const TOOLS_CONTEXTO = declararTools([
  {
    name: "crm_como_funciona",
    category: "read",
    rotulo: "Entender este sistema",
    explicacao:
      "Explica ao assistente onde ele está, quais permissões recebeu e quais regras precisa respeitar antes de começar.",
    oQueToca: "Contexto do assistente",
    risco: "seguro",
    pacotes: ["atender", "vender", "organizar"],
  },
]);
