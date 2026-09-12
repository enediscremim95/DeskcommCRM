# Revisão integral de experiência do CRM Veritas

## Escopo auditado

A revisão cobriu as 66 rotas autenticadas sob `app/app`, o shell compartilhado, o catálogo de navegação, os hubs de seção, a busca por comandos, os estados responsivos e as quatro aparências existentes. A leitura incluiu Atendimento, CRM, Agente de IA, Canais, Análise, LGPD, equipe, configurações e administração do tenant.

### Inventário por jornada

- Atendimento: início, Caixa de entrada, conversa, Agenda, Radar e Respostas rápidas.
- CRM: hub, Funis, funil individual, Contatos, contato individual, negócio individual, Tarefas e Produtos.
- Agente de IA: hub, agentes, criação e edição, casos, credenciais, evolução, acompanhamentos, matrículas, caixa da IA, conhecimento, memória, propostas, provedores, roteadores, execuções, habilidades e uso.
- Canais: conexões, Nuvemshop, webhooks e Meta Ads.
- Análise: hub, atividades, auditoria, métricas, resultados e relatório.
- Organização: configurações, aparência, tokens de API, atendimento, atualização, cobrança, canal oficial, conversões, marca, Meta Ads, notificações, perfil, segurança, modelos, organização, agenda, funis, WhatsApp, equipe, convite e solicitações LGPD.

## Achados confirmados no código

1. O shell adicionava `p-3 sm:p-6` ao conteúdo, enquanto 52 páginas ou clientes já aplicavam o próprio `p-6`. O resultado frequente era 48 px de margem no desktop e menos área útil para tabelas, caixa de entrada e quadros.
2. No celular, a navegação dependia exclusivamente do botão que abre a gaveta. Cada troca entre Caixa de entrada, Radar, Funis e Tarefas exigia abrir o menu novamente.
3. A barra superior permitia quebra em duas linhas no celular. O grupo da direita usava largura total e disputava espaço com organização, busca, avisos, aparência e usuário.
4. Os hubs de CRM, IA, Análise e Organização apresentavam uma grade funcional, mas a sequência da jornada tinha pouco contraste visual.
5. O botão compacto de busca não tinha nome acessível quando o texto era ocultado no celular.
6. O shell não oferecia um atalho para teclado pular diretamente ao conteúdo principal.
7. Quatro componentes usavam `transition-all`, ampliando a superfície de animação além das propriedades que realmente mudavam.

## Decisões aplicadas

- O `AppShell` deixou de impor margem geral ao conteúdo. Cada página volta a controlar seu espaço uma única vez, e superfícies de trabalho que precisam ocupar toda a largura continuam livres para fazê-lo.
- O celular ganhou um dock inferior persistente com destinos diários derivados do mesmo catálogo e das mesmas permissões do menu. A gaveta permanece como inventário completo.
- A barra superior foi mantida em uma linha no celular; o atalho de aparência permanece disponível em Configurações.
- Os hubs agora destacam grupo, sequência, quantidade de destinos, descrições e ação de entrada em cada tela.
- Busca, foco por teclado, alvos de toque e estado ativo receberam nomes e sinais acessíveis.
- As transições foram limitadas às propriedades visuais usadas por cada componente.
- As quatro aparências continuam usando os mesmos tokens semânticos, inclusive no novo dock.

## Limites preservados

Esta revisão não alterou banco de dados, contratos de API, regras de negócio, permissões, rotas, filas, integrações ou dados de clientes. A mudança está concentrada na casca compartilhada e nas projeções do catálogo de navegação.

## Checklist do sistema vivo

1. Entrada: `lib/navigation` mantém destinos, rótulos, jornadas e requisitos de acesso.
2. Saída: Sidebar, gaveta móvel, MobileDock, NavHub, busca e breadcrumbs projetam essa fonte.
3. Rastro: navegação não muta dados e, portanto, não gera evento operacional; o estado visível é a própria rota.
4. Tela: o `AppShell` envolve todas as 66 rotas autenticadas.
5. Porta: sidebar no desktop, dock e gaveta no celular, hubs e busca por comandos.
6. Continuidade: o dock acelera a rotina, enquanto a gaveta mantém todos os destinos alcançáveis.
7. Configuração: papel, suporte e `interface_settings` filtram todas as projeções antes da renderização.
8. Cooperação: nenhuma passagem entre pessoa e agente foi modificada; somente o acesso às telas ficou mais direto.
9. Retorno: `aria-current`, destaque visual e breadcrumb mostram onde a pessoa está; os testes E2E guardam alcance, alvo de toque e overflow.
10. Mapa: `navegacao-do-app.architecture.json` registra a nova projeção móvel e suas ligações com catálogo, permissão e rota.

## Critério de validação

A entrega deve passar por typecheck, lint, testes unitários de navegação, i18n e mapas, além da prova E2E em 390 px e desktop. A validação E2E confirma que o dock está visível, respeita alvos de toque, muda o estado ativo, não cria rolagem horizontal e convive com a gaveta completa.
