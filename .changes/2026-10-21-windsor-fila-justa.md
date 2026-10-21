---
impacto: nada_mudou
secao: corrigido
titulo: Relatório de tráfego não fica preso em contas lentas do Windsor
---

A sincronização agora prioriza as organizações há mais tempo sem dados novos e tenta novamente uma chamada que expirou, sem iniciar a nova tentativa depois do prazo global. Se o resumo Meta de 90 dias ainda expirar, ele é buscado em três janelas consecutivas de 30 dias. O relatório também deixa o alcance indisponível após 8 segundos se o Windsor estiver lento, mantendo os demais dados acessíveis.
