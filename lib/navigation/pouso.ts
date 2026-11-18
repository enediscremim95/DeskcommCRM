/**
 * Para onde vai quem acabou de entrar, terminar o onboarding ou foi barrado.
 *
 * É o quadro dos Funis, o mesmo destino de `homeDaInterface` para quem tem a
 * interface completa. Fica num módulo sem dependências para que páginas de
 * servidor e componentes de cliente usem o mesmo valor, e para que o endereço
 * não apareça solto em arquivos de tela, onde o teste de vocabulário do funil
 * procura as palavras do sistema.
 *
 * O Inbox deixou de redirecionar para cá: quem mandava para `/app/inbox`
 * contando com esse redirecionamento passaria a pousar na lista de conversas.
 */
export const POUSO_PADRAO = "/app/kanban" as const;
