---
impacto: nada_mudou
secao: corrigido
titulo: O laço rápido do worker volta a montar o admin client
---

`@react-pdf/hyphenate` é ESM puro e não expunha a condição `require` no seu `exports`.
