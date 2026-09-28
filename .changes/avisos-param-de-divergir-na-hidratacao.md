---
impacto: nada_mudou
secao: corrigido
titulo: Preferências de aviso param de divergir entre o servidor e o navegador
---

A tela de configurações de notificação abria com o navegador discordando do HTML que o servidor tinha mandado. Quem havia desligado o push de mensagem via, por um instante, o interruptor ligado — e o React reagia a essa discordância descartando e refazendo a árvore da tela no cliente.
