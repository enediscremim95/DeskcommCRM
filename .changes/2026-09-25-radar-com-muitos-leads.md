---
impacto: nada_mudou
secao: corrigido
titulo: Radar volta a abrir em operações com muitos negócios
---

O Radar podia falhar ao carregar quando a organização tinha centenas de negócios abertos, porque a consulta de tarefas enviava todos os identificadores de uma vez. A leitura agora divide esse volume em blocos e preserva a mesma ordenação e o mesmo limite.
