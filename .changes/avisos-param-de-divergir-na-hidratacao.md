---
impacto: nada_mudou
secao: corrigido
titulo: Preferências de aviso param de divergir entre o servidor e o navegador
---

A tela de configurações de notificação abria com o navegador discordando do HTML que o servidor tinha mandado. Quem havia desligado o push de mensagem via, por um instante, o interruptor ligado — e o React reagia a essa discordância descartando e refazendo a árvore da tela no cliente.

O valor era lido dentro do inicializador de `useState`, que roda de novo na hidratação. Sem `window`, essa leitura devolve o padrão (tudo ligado); com `window`, devolve o que está no `localStorage`. Os dois lados não tinham como concordar para quem tivesse mudado qualquer preferência — em dez interruptores e no identificador que a tela de alertas procura.

A tela passou a ler as preferências por `useSyncExternalStore`, o mesmo mecanismo que o seletor de tema já usa desde o #666: existe um valor determinístico para a comparação de hidratação, e só depois do commit o React troca para o valor real. O interruptor continua respondendo na hora, sem recarregar a página.

Sem mudança de configuração: nada a editar no `.env` e nenhum passo a mais na atualização.

Achado a partir do relato de que a divergência reaparecia a cada conserto — a leitura do navegador voltava para dentro de um inicializador novo. Junto vem a guarda que reprova esse padrão, para que a terceira instância não nasça igual.
