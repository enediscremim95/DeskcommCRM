---
impacto: capacidade_nova
secao: adicionado
titulo: Organização nova recebe o funil, as respostas e o atendente do nicho dela em um clique
---

Quem administra a plataforma passa a ter um cartão "Modelo de negócio" na tela de cada organização, com três modelos: **Serviços e agência**, **Imobiliária** e **Clínica e agenda**. Aplicar um deles deixa a organização configurada para o ramo do cliente em vez de nascer com o funil de e-commerce genérico.

O modelo entrega, de uma vez: as colunas do funil com o vocabulário do nicho, os campos que aquele negócio precisa preencher no contato, os motivos de perda, as tags sugeridas do inbox, as respostas prontas da equipe, as instruções do atendente de IA e as cadências de follow-up já desenhadas.

Duas coisas entram **desligadas**, de propósito. O atendente recebe as instruções como rascunho e não vai ao ar sem alguém publicar, porque publicar aqui poria a falar com cliente final um texto que ninguém da empresa leu. As cadências entram como rascunho e sem versão ativa, porque cadência ligada numa organização recém-criada começaria a mandar WhatsApp em nome de um cliente que ainda não viu a mensagem.

O modelo é configuração declarada em código, nunca uma cópia de outra organização. Nada de contato, conversa, mensagem, negócio, credencial, canal de WhatsApp ou webhook atravessa de um cliente para outro — a função que aplica não tem um único comando que leia organização diferente da que está recebendo, e isso é cobrado por teste contra o Postgres de verdade.

Aplicar é seguro de repetir: o segundo clique não duplica resposta pronta nem cadência, e não sobrescreve cadência que alguém já tenha editado. Só funciona em funil vazio: se a organização já tem negócio dentro, nada é alterado e a tela explica por quê.

Nada muda na configuração da VPS: não há variável nova para preencher nem passo de atualização.
