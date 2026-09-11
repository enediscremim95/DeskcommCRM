---
impacto: nada_mudou
secao: corrigido
titulo: Criar organização volta a respeitar a área de trabalho escolhida para o dono
---

Quem cria uma organização pelo painel da plataforma escolhe, no formulário, a área de trabalho do dono dela. A escolha estava sendo descartada: todo dono caía na interface completa, independentemente do que tivesse sido marcado.

A causa foi uma reescrita. A mudança que adicionou a URL de relatório por organização refez a função de criação partindo de uma cópia antiga e, sem avisar, desfez três coisas que já estavam lá: a gravação da área de trabalho do dono, a marca que identifica um recibo de criação como produzido pelo servidor, e a conferência de procedência quando a mesma criação é reenviada. As três voltaram.

Quem já instalou recebe a correção na atualização, sem passo manual. Organizações criadas no intervalo ficaram com a interface completa; a área de trabalho de cada pessoa continua editável em Configurações › Equipe.
