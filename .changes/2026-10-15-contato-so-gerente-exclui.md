---
impacto: nada_mudou
secao: corrigido
titulo: Só o gerente exclui contato, como já era com o lead
---

O papel admin não exclui leads (decisão de 25/09), mas ainda via o botão de excluir na tela de Contatos e a rota `DELETE /api/v1/contacts/[id]` aceitava a permissão geral. Excluir o contato apaga a pessoa do lead, então a rota e o botão passam a exigir a mesma capacidade `lead.delete`, que é do gerente. Remover etiquetas continua com a permissão geral.
