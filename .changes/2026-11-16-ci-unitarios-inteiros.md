---
impacto: nada_mudou
secao: corrigido
titulo: O CI executa os unitários inteiros em duas partes
---
A suíte usa partição nativa em dois runners, mantendo todos os testes e o limite de 15 minutos. O check verify exige o sucesso das duas partes, além de typecheck, lint e testes shell.
