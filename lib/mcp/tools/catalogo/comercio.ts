/**
 * Capacidades de COMÉRCIO e PRIVACIDADE — o que o cliente comprou, o que existe
 * à venda, e quem pediu para sair.
 *
 * Ver `docs/handoffs/BRIEFING-ia-360.md` §4 para o contrato dos campos.
 */
import { declararTools } from "./tipos";

export const TOOLS_COMERCIO = declararTools([
  {
    name: "crm_list_contact_orders",
    category: "read",
    rotulo: "Ver as compras do cliente",
    explicacao:
      "Mostra o que este cliente já comprou, quanto pagou e como está a entrega, para o assistente não prometer prazo no escuro nem repetir uma oferta já aceita.",
    oQueToca: "Compras do cliente",
    risco: "seguro",
    pacotes: ["vender", "atender"],
  },
  {
    name: "crm_search_products",
    category: "read",
    rotulo: "Procurar produto na loja",
    explicacao:
      "Procura um produto no catálogo da loja e devolve o preço exato e o que está disponível, para o assistente responder com o valor cadastrado em vez de estimar.",
    oQueToca: "Catálogo da loja",
    risco: "seguro",
    pacotes: ["vender", "atender"],
  },
  {
    name: "crm_send_catalog_item",
    category: "write",
    rotulo: "Enviar produto com fotos",
    explicacao:
      "Envia ao cliente as fotos e o preço atual de um produto cadastrado, sem permitir que o assistente invente valor, legenda ou endereço de imagem.",
    oQueToca: "Catálogo e conversa",
    // Mesmo precedente de `crm_send_whatsapp_message`: fala com o cliente, então é risco crítico e NUNCA entra
    // nas capacidades padrão de um agente novo; só quem escolhe a ferramenta de propósito a recebe.
    risco: "critico",
    pacotes: ["atender"],
  },
  {
    name: "crm_send_vitrine",
    category: "write",
    rotulo: "Mostrar vitrine de produtos",
    explicacao:
      "Envia uma sequência pronta de produtos com fotos, títulos e valores cadastrados, na ordem definida pela loja e sem deixar o assistente trocar versões ou repetir preços.",
    oQueToca: "Catálogo e conversa",
    risco: "critico",
    pacotes: ["atender"],
  },
  {
    name: "crm_list_privacy_requests",
    category: "read",
    rotulo: "Ver pedidos de privacidade",
    explicacao:
      "Mostra quem pediu para exportar ou apagar os próprios dados e qual o prazo, para o assistente parar de insistir com quem pediu para sair.",
    oQueToca: "Privacidade e dados do cliente",
    risco: "seguro",
    pacotes: ["atender"],
  },
]);
