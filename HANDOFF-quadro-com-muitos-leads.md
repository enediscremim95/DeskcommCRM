# HANDOFF: o funil quebra quando o cliente tem muitos negócios (bug em produção AGORA)

## O sintoma, visto pelo cliente
Organização `sublimando`, funil "Funil de vendas": a tela abre e mostra
**"Não consegui carregar este funil: Bad Request"**. Nada carrega. Reportado em 24/09/2026 pela
pessoa que usa o CRM todo dia.

## A causa, REPRODUZIDA (não é teoria)
`app/api/v1/pipelines/[id]/board/route.ts` busca **todos** os negócios do funil sem limite e
depois cruza com dono, próxima ação, score e conversa usando `in.(<todos os ids>)`. Esse funil tem
**1.631 negócios**. Rodado dentro do contêiner de produção, contra o PostgREST real:

```
leads: 1000                      (o PostgREST já corta em 1000 por padrão)
tamanho da URL: 37104 caracteres
status da consulta com todos os ids: 400 Bad Request
resposta: Bad Request
```

São **dois defeitos somados**:

1. **URL estourada:** 1.000 UUIDs numa querystring dão 37 KB e o servidor recusa com 400, cujo
   corpo é literalmente "Bad Request", que é o texto que aparece na tela do cliente.
2. **Teto invisível de 1.000:** mesmo que a consulta passasse, o funil mostraria 1.000 dos 1.631
   negócios, calado. Um quadro que esconde 631 negócios sem dizer nada é pior que um erro.

## O que construir

1. **Nunca mandar lista ilimitada de ids numa URL.** Quebre as consultas auxiliares em lotes (algo
   como 200 por chamada) e junte os resultados, ou troque por uma consulta só com `join`/RPC que
   não precise dos ids na querystring. Resolva na camada que faz isso, para valer em toda consulta
   do mesmo tipo, não só nas quatro deste arquivo. **Procure outras rotas com o mesmo padrão** e
   diga no PR o que achou.
2. **O quadro passa a carregar por etapa, com paginação.** Cada coluna traz as primeiras N (50 é
   um bom começo), com a **contagem real** no topo da coluna, e carrega mais conforme a pessoa
   rola. Nada de teto silencioso: se há 1.631, a tela diz 1.631.
3. **Erro de carregamento vira frase útil.** "Bad Request" não é mensagem para um humano. Quando
   falhar, diga o que houve em português e ofereça tentar de novo.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Ordenação por `position_in_stage` e o arrastar entre etapas precisam continuar
  corretos com a paginação: arrastar um cartão para uma coluna parcialmente carregada não pode
  embaralhar a ordem nem "sumir" com o cartão.
- Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- Testes que provam: um funil com mais de 1.000 negócios carrega sem 400 (exercite o lote, não
  confie em mock que aceita qualquer URL); a contagem da coluna mostra o total real; e o quadro
  continua correto ao arrastar com paginação ativa.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**.
- Commit na branch atual (`fix/quadro-com-muitos-leads`), sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
