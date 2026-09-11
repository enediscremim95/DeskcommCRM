---
impacto: nada_mudou
secao: corrigido
titulo: O ícone da aba volta a aparecer
---

A aba do navegador ficou sem ícone. A causa foram duas mudanças que se somaram: um arquivo de ícone estático entrou ao lado do ícone que o sistema gera, e a linha que declara qual dos dois o navegador deve pedir foi removida. Sem ela, o navegador volta a pedir `/favicon.ico`, que não existe, e recebe a página de erro inteira em vez de uma imagem.

O arquivo estático saiu e a declaração voltou. O ícone volta a ser desenhado em tempo de execução a partir da marca configurada, que é o que permite cada instalação ter a sua: um arquivo dentro da imagem entregaria a mesma marca para todas.

Nada muda na configuração, e o ícone aparece na próxima recarga sem cache.
