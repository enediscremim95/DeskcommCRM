---
impacto: nada_mudou
secao: corrigido
titulo: Uma requisição que demora demais não vira mais um erro genérico na tela
---

Quando uma chamada à API não respondia a tempo, o navegador mostrava um erro genérico ("signal is aborted without reason") em vez de dizer que foi um tempo esgotado. Agora o motivo do cancelamento vem explícito, com o mesmo nome que o resto do produto já usa para timeout — quem lida com o erro consegue reconhecê-lo, e quem só vê a tela entende o que aconteceu.
