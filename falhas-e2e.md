# As 6 specs que reprovaram no e2e (parte 2), medidas no CI

Run 36173825364, commit 4759c5f2. Resultado: **92 passaram, 6 falharam**.

1. `agenda-escopo-da-organizacao.spec.ts:116` — membro de duas organizações vê na Agenda só os tipos da organização ativa
2. `agenda-ocupacao-do-google-na-grade.spec.ts:218` — a ocupação do Google sobrevive à troca de semana e à visão Mês
3. `automacao-diz-a-verdade.spec.ts:114` — envio que morre aparece como FALHOU, com a razão, nunca como sucesso
4. `capacidades-do-agente.spec.ts:203` — ligar uma jornada NÃO dá ao agente o direito de mandar WhatsApp
5. `distribuicao-atendimento.spec.ts:73` — **manager** liga o rodízio e a restrição pela tela, e o estado sobrevive ao reload
6. `followup-dossie.spec.ts:190` — **manager** abre o dossiê pela fila, lê a história traduzida e intervém

Duas delas (5 e 6) exercitam justamente o papel **manager**, que mudou hoje: gerente passou a ter acesso total, e `lead.delete` e `team.manage` saíram da escada de papéis e viraram capacidades nomeadas. Suspeita forte de que o conserto está aí, e não no teste.

A 4 é sobre o agente NÃO ganhar direito de mandar WhatsApp ao ligar uma jornada: se a mudança de papéis ou o fluxo novo afrouxou isso, é regressão de segurança e tem prioridade.
