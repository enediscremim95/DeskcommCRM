---
impacto: nada_mudou
secao: corrigido
titulo: A chamada de voz avisa quando não há áudio, em vez de contar o tempo em silêncio
---

O painel da ligação em andamento mostrava o cronômetro correndo assim que o WhatsApp
atendia — e o cronômetro continuava correndo mesmo quando o som não chegava ao navegador.
Uma ligação muda tinha exatamente a mesma aparência de uma ligação perfeita: nenhum aviso,
nenhum sinal, só o relógio. Quem instalou numa VPS ficava sem saber se o problema era o
microfone, a rede do escritório ou o produto.

Agora o painel escuta a conexão de áudio de verdade. Enquanto ela está abrindo, ele diz
**"Abrindo o áudio…"**. Se ela não abrir, ele diz **"Sem áudio: o canal de voz não abriu"**
— e o cronômetro continua, porque a ligação existe mesmo e o outro lado está esperando. O
silêncio deixa de se disfarçar de normalidade.

Se o servidor de voz demorar demais para responder, o aviso aparece em até 12 segundos, em
vez de "Abrindo o áudio…" para sempre. E se a conexão se restabelecer depois de um soluço
de rede, o aviso some sozinho.

Nada muda para quem não usa chamada de voz.

Trabalho original da chamada de voz de @eudanielhenrique.
