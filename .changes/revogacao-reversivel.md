---
impacto: capacidade_nova
secao: corrigido
titulo: Revogar um membro deixa de ser uma porta que só abre por fora
---

Revogar sumia com a pessoa. Ela desaparecia da lista de Equipe, e a única forma de devolver o acesso era emitir um convite novo — um caminho longo, com três becos, todos medidos numa instalação real com alguém de verdade preso neles.

**O que muda:**

- **O membro revogado continua na lista**, com o estado `Revogado`, e quem administra devolve o acesso pelo menu da própria linha. Antes ele simplesmente sumia.
- **Quem já tem conta e clica num convite** deixa de receber *"Não foi possível criar a conta. Tente novamente."* — instrução impossível, porque tentar de novo nunca funciona. Passa a ler que já tem conta, com um botão que entra **e** cai direto no aceite.
- **A tela de acesso revogado deixa de ser beco:** ela diz que, se chegou convite novo, o link do e-mail funciona mesmo dali.

**Nada disso mudou o banco.** O comando que aceita convite já sabia reativar quem foi revogado, desde que o convite seja posterior à revogação — e foi exatamente isso que a prova em tela confirmou. O que faltava era caminho até ele.

**Reativar não promove.** Ela devolve o papel que a pessoa tinha; trocar papel continua sendo outra ação, com outra rota. Juntar as duas faria uma reativação distraída virar promoção silenciosa.

**Quem devolveu o acesso fica registrado** (`member.reactivated`). A coluna que guarda a revogação volta a ficar vazia e não conta história nenhuma — a trilha é a única resposta para "quem readmitiu esta pessoa, e quando?".
