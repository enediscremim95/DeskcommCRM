import type { Locator, Page } from "@playwright/test";

/**
 * A raiz ATIVA da Agenda.
 *
 * O App Router pode manter a árvore anterior montada e oculta durante uma
 * navegação. Um `getByTestId` global passa então a encontrar duas agendas e,
 * pior, um `.first()` pode ler a semana antiga. O usuário só consegue operar a
 * árvore visível, e é essa mesma superfície que o E2E deve dirigir.
 */
export function telaDaAgendaVisivel(page: Page): Locator {
  return page.getByTestId("tela-agenda").filter({ visible: true });
}

/** A raiz ativa da configuração de tipos, pela mesma regra da Agenda. */
export function configuracaoDaAgendaVisivel(page: Page): Locator {
  return page.getByTestId("tipos-de-agendamento-config").filter({ visible: true });
}
