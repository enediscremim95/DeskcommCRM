# HANDOFF: o atendimento vira UM fluxo no canvas, e a IA monta junto

## O que o dono disse (25/09/2026), com o print do menu na mão
"Tem muita coisa aqui que faz quem mexe ficar perdido, não é intuitivo, não é prático. Eu quero que
seja um fluxo no estilo do n8n, onde a gente possa usar o MCP e ela mesma ajuda a criar esse fluxo,
com todas as boas práticas de atendimento e com as travas de segurança e de limite."

Hoje o grupo **Atendimento com IA** tem oito portas: Montar atendimento, Agentes, Conhecimento,
Skills, Roteadores, Follow-ups, Casos e Alertas. Quem chega precisa entender a arquitetura do
produto antes de atender um cliente. Medido: **zero agentes criados em 24 organizações**.

## A boa notícia: o canvas já existe
`app/app/ai/followups/[id]/_components/` tem `FlowCanvas`, `FlowBuilder`, `NodePalette`,
`NodeConfigPanel`, `EdgeConfigPanel` e `PublishBar`, sobre `@xyflow/react`. **Reaproveite essas
peças**; não traga biblioteca nova nem escreva um segundo canvas.

## O que construir

### 1. Uma tela de fluxo para o atendimento inteiro
`/app/ai/atendimento` passa a ser um canvas onde o atendimento é UM fluxo, com nós que hoje são
telas separadas:

- **Quando chega mensagem** (gatilho): o canal, o horário de atendimento, e o que fazer fora dele.
- **Quem atende** (agente): objetivo, tom, e o modelo que ele usa.
- **O que ele sabe** (conhecimento): texto, arquivo ou site.
- **O que ele pode fazer** (skills): as ações, uma a uma.
- **Quando passa para humano**: a condição e para quem vai.
- **Se esfriar** (follow-up): liga o fluxo de retomada que já existe, sem duplicá-lo.
- **Limites**: ritmo humano, uma conversa por vez, teto por dia.

As telas antigas continuam existindo para ajuste fino, mas saem do menu principal: o grupo fica com
**Atendimento** (o fluxo), **Casos** e **Alertas**, que são operação do dia a dia, não configuração.

### 2. As boas práticas vêm ligadas, não como dever de casa
Um fluxo novo nasce de um modelo por nicho **já com as travas ligadas**, e cada uma aparece como nó
ou propriedade visível, para a pessoa ver que existe:

- quem pediu para parar nunca mais recebe mensagem;
- não responder por cima de atendimento humano em andamento;
- horário de atendimento, com o que chega fora dele sendo respondido na abertura;
- ritmo humano e uma conversa por vez;
- teto de mensagens por dia no número;
- nunca prometer o que não pode cumprir, nem inventar dado que ferramenta nenhuma devolveu.

**Desligar uma trava é possível e explícito**, com a consequência escrita na tela em uma frase. O
que não pode é a pessoa descobrir que a trava não existia depois que o cliente reclamou.

### 3. A IA monta o fluxo pelo MCP
A branch `feat/mcp-monta-atendimento` está criando a camada de montagem por MCP (escopo separado,
tudo vira rascunho, publicar é ato humano). **Esta tela é o outro lado disso**: o fluxo montado pela
IA aparece no canvas como rascunho, com o que mudou destacado e os botões de publicar ou descartar.
Se as duas frentes colidirem no mesmo arquivo, esta cede e se adapta ao que a outra definiu.

Dentro da própria tela, um campo de conversa onde a pessoa escreve o que quer em português ("quero
que atenda quem pede orçamento de louça e me passe quando falarem de prazo") e o fluxo é proposto
no canvas, para ela revisar e publicar. Use a mesma camada do MCP; não crie um segundo caminho de
montagem.

### 4. Publicar é um ato, e dá para voltar atrás
Uma barra de publicação como a do follow-up: rascunho, o que mudou, publicar, e histórico das
versões com a opção de voltar para a anterior. Quem publica fica registrado.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Vale o item 14 do Definition of Done: tela no menu vai ao registro de navegação.
- **Não duplique o motor.** Janela de atendimento, ritmo, follow-up, opt-out e limite de conversas
  já existem em `lib/agent-engine`; o canvas configura o que existe, não reimplementa.
- Quem pode: administrador e **gerente** (decisão do dono: gerente tem acesso total).
- Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- Funciona no celular ao menos para LER o fluxo e publicar; montar arrastando pode ser só no
  computador, e a tela diz isso em vez de ficar quebrada.
- Migration com a tripla completa se mexer em schema. **Mudança que lê coluna nova não é provada
  por teste com banco simulado** — hoje isso custou um cron quebrado em produção por sete horas.
- Testes que provem: fluxo novo nasce com as travas ligadas; desligar uma trava exige ato explícito
  e registra quem fez; publicar cria versão e dá para voltar; e o rascunho vindo do MCP aparece no
  canvas.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` curto, no máximo 4 linhas. Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
