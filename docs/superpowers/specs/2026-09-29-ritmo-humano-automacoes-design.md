# Ritmo humano nas mensagens de automação

## Decisão

O motor de `automation_rules` usa o próprio `event_log` como relógio durável.
Ele não mantém `setTimeout` aberto. Cada espera grava o cursor da regra em
`event_log.metadata`, atualiza a execução visível em `automation_rule_runs` e
devolve `retry_at`. O drain libera o processo, continua os outros eventos e
retoma a mesma ação quando o horário vencer.

## Alternativas avaliadas

1. **Reagendar no `event_log` (escolhida).** Reusa a fila que já é dona das
   automações, preserva a ordem das ações e não exige schema novo.
2. **Criar um job novo em `job_queue`.** Também seria durável, mas duplicaria o
   estado da execução entre duas filas e ampliaria o worker, o schema e o
   protocolo de idempotência sem necessidade.
3. **Esperar com `setTimeout` no handler.** Rejeitada: o drain processa eventos
   em série e é aguardado pela rota cron. Uma pausa de 40–100 segundos prenderia
   a linha em `processing`, atrasaria eventos vizinhos e poderia estourar o
   request.

## Fluxo

1. Ações não textuais continuam rodando imediatamente e na ordem declarada.
2. Antes da primeira ação com capability de ritmo humano, o evento é reagendado
   por 40–100 segundos.
3. No retorno, o canal recebe o sinal opcional de `digitando`. O evento é
   reagendado pelo trecho de 3–15 segundos, sem dormir no processo.
4. No retorno seguinte, a mensagem é enviada. O restante do alvo calculado fica
   como pausa silenciosa antes da próxima mensagem textual da mesma regra.
5. O cursor inclui regra, índice da ação, resultados acumulados e fase. Uma
   retomada não repete as ações anteriores da mesma execução.

## Interrupção por resposta humana

Antes da espera, de cada retomada e do envio efetivo, o motor consulta a mesma
classificação de autoria humana usada pela reatividade dos follow-ups. Uma
mensagem `outbound` com `sent_via=user|external_device` e `created_at` maior que
o `created_at` do evento torna a sequência obsoleta. A regra inteira termina
naquele ponto: não envia a mensagem e não executa tags ou outros efeitos
restantes. Mensagem humana anterior ao evento pertence ao histórico antigo e
não interfere; saídas `ai`/`automation` não contam como humano.

A consulta falha fechada. Se não for possível provar que a regra ainda pode
falar, ela termina sem envio e grava o motivo no `automation_rule_run`.

## Fórmula

```text
alvo = (20.000 + tamanho_do_texto × 600) × variação(0,9 a 1,2)
digitando = min(15.000, max(3.000, round(alvo × 0,45)))
restante = alvo - digitando
```

O tamanho usado é o texto final já renderizado com as variáveis do template.

## Falhas e visibilidade

O indicador de presença é decorativo: falha macio e nunca impede a mensagem.
A espera é registrada como `adiado` na aba de atividade, com o motivo e o
`retry_at`. Se a persistência do cursor falhar, o handler falha fechado em vez
de fingir que a espera foi agendada.

## Provas

- teste puro fixa os extremos da fórmula e os limites do indicador;
- teste do motor verifica que a primeira espera retorna `retry` sem chamar
  `setTimeout` nem executar o envio;
- teste do motor cobre resposta humana anterior ao evento, posterior durante a
  espera e ausente, além de provar que as tags seguintes não rodam no veto;
- a suíte existente do drain já prova que um evento em `retry` não impede os
  demais eventos do mesmo lote de concluírem.
