---
impacto: nada_mudou
secao: corrigido
titulo: PDF com defeito não derruba mais o processador de mensagens
---

A leitura de PDF agora acontece numa thread isolada, com teto de tamanho, páginas, memória e tempo. Um arquivo defeituoso deixa somente o próprio derivado indisponível, sem reiniciar o processador nem travar mensagens e filas. Eventos interrompidos repetidamente também são encerrados em vez de voltar para um ciclo infinito.
