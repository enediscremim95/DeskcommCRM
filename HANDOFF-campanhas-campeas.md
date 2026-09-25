# HANDOFF: cartões de campanhas campeãs no PDF

Faltou do `HANDOFF-relatorio-mais-rico.md`, item 2: **três cartões de destaque com a CAMPANHA campeã**
(ou anúncio/criativo, se houver dado de anúncio): "Mais leads", "Menor custo por lead", "Melhor conversão",
cada um com o nome e o número. A entrega trouxe "Destaques do período" em frases gerais, que continuam; os
cartões de campeã entram ALÉM deles, logo abaixo das métricas macro do PDF.

- Amostra mínima para eleger: ≥20 leads para "Menor custo por lead" e ≥40 para "Melhor conversão"; sem amostra,
  o cartão diz "Sem dados suficientes". "Mais leads" não precisa de mínimo.
- Leads por campanha = o que a plataforma atribui à campanha no período (é a única régua que existe por campanha).
- Nenhuma nota explicativa. Português e espanhol via `text()`.
- Na mesma branch, depois da etapa 3 (status/filtro/ordenação). `git fetch` + merge da `origin/main` antes do commit
  (a main já recebeu o PR #40 com as etapas 1 e 2). Verificações de sempre, fragmento em `.changes/`, amostra em
  ambiente node conferida visualmente. **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
