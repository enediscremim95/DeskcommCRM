# HANDOFF: o atendimento com IA sai da sombra e o n8n sai do caminho

## O que foi medido hoje (25/09/2026)
- `lib/navigation/catalogo.ts`: das telas de IA, **só `Follow-ups` e `Provedores` têm
  `sidebar: true`**. `Agentes nativos`, `Roteadores`, `Conhecimento`, `Skills`, `Memória`,
  `Casos`, `Alertas`, `Propostas` e `Credenciais` existem, funcionam e **não aparecem no menu**:
  só se chega digitando a URL.
- O que ocupa o grupo **Automação** no menu é o **N8N** (`/app/ai/workflows`), que é integração
  externa e está dando problema para o dono.
- No banco de produção: **zero linhas em `ai_agents`**, em todas as 24 organizações. O motor
  nativo nunca foi usado, não por falta de recurso, mas por falta de porta.

## Decisão do dono
Tirar o n8n do caminho principal e usar o motor nativo do CRM para montar fluxos de atendimento
com IA no WhatsApp.

## O que construir

### 1. O grupo passa a se chamar pelo que faz
`Automação` vira **Atendimento com IA** (rótulo do grupo em `lib/navigation/catalogo.ts`), com as
telas na ordem em que se usa:

1. **Agentes** (`/app/ai/agents`) — quem atende, o que ele sabe fazer, com que tom.
2. **Conhecimento** (`/app/ai/knowledge/sources`) — o material que ele consulta antes de responder.
3. **Skills** (`/app/ai/skills`) — as ações que ele pode executar sozinho.
4. **Roteadores** (`/app/ai/routers`) — qual agente pega qual conversa e quando o humano assume.
5. **Follow-ups** (`/app/ai/followups`) — como ele retoma quem esfriou.
6. **Casos** (`/app/ai/cases`) — o que ele já atendeu, do início ao fim.
7. **Alertas** (`/app/ai/inbox`) — o que ele encontrou e precisa de decisão.

`Provedores`, `Credenciais`, `Memória`, `Propostas`, `Execuções` e `Uso` continuam existindo, mas
como ajuste fino: deixe-os fora do menu principal ou num rodapé do grupo, para a primeira leitura
não virar lista de vinte itens.

### 2. O N8N sai do menu, sem sumir
`/app/ai/workflows` perde o `sidebar: true` e continua alcançável pelo ⌘K e pela URL, como a
Nuvemshop já faz hoje (o comentário dela no catálogo explica o padrão e serve de modelo). Nada de
apagar rota, página ou permissão: quem já vinculou fluxo continua vendo.

### 3. Uma porta de entrada que ensina
Em **Agentes**, quando a organização ainda não tem nenhum (é o caso de todas hoje), a tela abre
com um caminho guiado de quatro passos, em português simples, em vez de uma lista vazia:

1. escolher o que o agente faz (atender e qualificar, tirar dúvidas, agendar);
2. dar a ele o material do negócio (link do site, texto colado, arquivo);
3. dizer quando o humano assume;
4. ligar no número de WhatsApp já conectado.

Ao final, um botão **"Conversar com o agente"** que abre uma conversa de teste, sem falar com
cliente nenhum. Ninguém liga um atendente automático no número da empresa sem experimentar antes.

### 4. Modelos prontos por nicho
Se `lib/` já tiver os modelos por nicho usados no `deskcomm-cliente-novo`, ofereça-os como ponto de
partida no passo 1. Reaproveite; não escreva prompt novo no código da tela.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Vale o item 14 do Definition of Done: tela que entra no menu vai ao registro.
- Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- Papel mínimo de cada tela continua o que já é hoje; isto é mudança de navegação, não de permissão.
- Testes que provam: o grupo tem as sete telas na ordem; `/app/ai/workflows` não está no menu e
  continua alcançável; e a tela de Agentes mostra o caminho guiado quando não há agente.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**.
- Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**

---

## Parte B: duas abas saem da tela de Conexões (mesmo pedido, 25/09/2026)
O dono mandou tirar também, com o print na mão, as abas **"Provedor parceiro"** e
**"Chamada de voz"** de `components/connections/ConexoesShell.tsx` (os gatilhos ficam por volta da
linha 82, e a aba vive na URL por `?aba=parceiro` e `?aba=voz`).

Regras do corte:
- **Esconder, não apagar.** Some o gatilho da barra de abas; a rota, o conteúdo, as permissões e
  o estado no banco continuam. Quem abrir `?aba=voz` direto continua chegando lá, como já acontece
  com a Nuvemshop no menu.
- **Quem já usa não perde nada.** Se a organização tiver o provedor parceiro conectado, ou a
  chamada de voz ligada, a aba correspondente **continua aparecendo** para ela: esconder o que
  está em uso viraria recurso órfão sem caminho de volta. É a mesma ideia de "esconder o que não
  se usa", aplicada com a medida certa.
- A aba padrão continua sendo **Números por QR**, e nada muda para quem já estava nela.
- Testes que provam: sem provedor parceiro e sem voz ligada, as duas abas não aparecem; com
  qualquer uma das duas em uso, a aba dela aparece; e a URL direta continua funcionando nos dois
  casos.
