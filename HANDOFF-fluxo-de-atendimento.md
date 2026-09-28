# HANDOFF: o atendimento do n8n vira fluxo nativo, e montar um fluxo fica simples

## De onde vem este briefing
Li os **cinco fluxos do n8n** que atendem a Sublimando hoje, direto do banco do n8n na VPS
(`Agente WhatsApp Sublimando`, 30 nós; `Carteiro`; `Follow-up`; `Bot Lorenza`; `Fila da abertura`)
e comparei com `lib/agent-engine`. O dono quer aposentar o n8n e montar os fluxos dentro do CRM.

**A maior parte já existe nativa.** Não reimplemente o que está na coluna da direita:

| Regra provada no n8n | Onde já vive no CRM |
|---|---|
| Horário de atendimento, e o que chega fora dele não se perde | `lib/agent-engine/agent/janela-de-atendimento.ts` (reagenda para a abertura) |
| Esperar a cliente terminar de escrever (buffer de 12s) | `INBOUND_DEBOUNCE_MS` (8s) no drain |
| Ritmo humano, "digitando", resposta em mensagens curtas | `atraso-humano.ts` + `split-message.ts` |
| Follow-up de quem sumiu | `followup-turn.ts` |
| Ignorar grupo, status, mensagem própria e mensagem velha | ingestão WAHA/Evolution |
| Quem pede para parar não recebe mais | `lib/opt-out/deteccao.ts` |
| Passar para humano, com caso registrado | motor de casos |

## Parte A: o que FALTA trazer (só duas coisas)

### A1. Uma conversa por vez, por canal ("a boca única")
No n8n isso é o fluxo **Carteiro**: um relógio de um minuto, uma trava global
(`pg_advisory_xact_lock`), e a regra "se alguma conversa está sendo atendida agora, não pego
outra", com **liberação automática em 16 minutos** caso a entrega morra no meio (o pior caso
medido por eles foi 12,4 min). Motivo, nas palavras do fluxo: *"era isso que faltava para a
Lorenza parar de aparecer falando com 4 pessoas no mesmo minuto"*.

No CRM: **um limite de conversas simultâneas por canal**, com padrão 1 e ajustável, ligado no
envio (não na geração). Quando o limite está ocupado, o turno **espera a vez** em vez de ser
descartado, e a espera tem teto (sugestão: o mesmo espírito dos 16 minutos, derivado do tempo
máximo de entrega, não um número mágico solto).

**Follow-up e atendimento dividem a MESMA vez.** No n8n isso foi corrigido depois de doer:
*"antes eram duas bocas (agente numa cliente, follow-up noutra, ao mesmo tempo), que é o padrão de
robô que estamos apagando"*. Um follow-up que dispara enquanto o agente responde outra pessoa
recria o defeito.

### A2. Etiquetar a conversa no WhatsApp conforme o desfecho
O n8n etiqueta a conversa com as etiquetas que a dona do negócio já usa, e o comentário explica por
quê: *"é assim que ela vê, na própria lista de conversas, o que cada uma é e onde precisa voltar.
Sem isso o agente teria que prometer 'já te respondo', que é justamente o que não pode"*.
Traga como ação do agente (skill), respeitando o que o provedor do canal suporta, e falhando em
silêncio quando não suportar: etiqueta é conveniência, não pode derrubar atendimento.

## Parte B: montar um fluxo tem que caber numa tela
Hoje, para ter um atendimento de pé, a pessoa precisa entender seis telas (Agentes, Conhecimento,
Skills, Roteadores, Follow-ups, Provedores). O dono, que é quem mais usa, achou complexo. **Zero
agentes criados em 24 organizações** é o número que mede isso.

Faça **uma tela de montagem, com quatro perguntas**, que grava nas estruturas que já existem (não
crie modelo de dados novo para isto):

1. **O que ele faz e como fala** — objetivo (atender e qualificar, tirar dúvidas, agendar) e tom.
2. **O que ele sabe** — colar texto, enviar arquivo ou apontar o site; vira fonte de conhecimento.
3. **Como ele se comporta** — horário de atendimento, ritmo humano ligado, e **"falar com uma
   pessoa por vez"** (A1) como um interruptor, não como configuração escondida.
4. **Quando o humano assume** — o que ele nunca responde sozinho, e para quem passa.

No fim: **"Conversar com o agente"**, um teste que não fala com cliente nenhum, e só depois
**"Ligar no número"**. Quem quiser ajuste fino continua tendo as telas avançadas, que ficam num
"ajustes avançados" e não no caminho principal.

## Parte C: os bugs que o n8n já pagou viram TESTE aqui
Estão escritos nos comentários do próprio fluxo, que são a memória de produção da operação. Cada
um vira um caso de teste nesta entrega:

1. **Resposta em dobro.** O buffer vivia na memória do processo; duas mensagens quase juntas liam
   o mesmo estado velho e as duas se achavam a última. *"Resultado real: cliente recebendo a mesma
   resposta 2x."* Teste: duas mensagens em menos de um segundo produzem **uma** resposta.
2. **Duas bocas ao mesmo tempo** (A1). Teste: com o limite em 1, um follow-up agendado não sai
   enquanto um atendimento está em curso naquele canal.
3. **Cliente da madrugada esquecida.** *"Antes disso o fluxo morria aqui e a cliente da madrugada
   nunca era atendida."* Teste: mensagem fora do horário é respondida na abertura, não descartada.
4. **Follow-up cobrando quem acabou de responder.** O fluxo precisou gravar também a fala da
   cliente depois que o agente cala, e a fala digitada pela atendente humana. Teste: contato que
   respondeu (ou que recebeu resposta humana) sai da fila de follow-up.
5. **Dormir dentro do banco.** *"Sem pg_sleep. Dormir aqui segurava a conexão do banco e travava o
   n8n."* Não segure recurso durante espera: a vez é estado, não bloqueio.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Mudança de schema exige a tripla completa (migration + apêndice idempotente no
  `baseline.sql` + MANIFEST), com RLS no formato `organization_id in (select public.fn_user_org_ids())`.
- Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- **Não copie código do n8n.** Ele é JavaScript solto com credencial dentro; o que se aproveita é a
  REGRA, escrita aqui.
- O limite de conversas simultâneas é **por canal e configurável**, com padrão 1, e vale para
  atendimento e follow-up juntos.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes, e `pnpm test:db`
  se tocar schema.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**.
- Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
