# HANDOFF (parte 2): o recurso precisa chegar à tabela que o dono estava olhando

## O que faltou
A parte 1 (commit `f46850c`) ficou boa, mas entrou só na `CampaignTable` de
`TrafficDashboard.tsx`. **O print que o dono mandou era a tabela "Anúncios Meta"**, que vive em
`app/app/relatorio/_components/RichReportSections.tsx` (o rótulo está na linha 476, a tabela logo
abaixo). Para ele, o recurso simplesmente não apareceu onde ele pediu.

## O que fazer
1. **Extrair o que a parte 1 criou** (estado de larguras, persistência em `localStorage` por
   organização, alça arrastável, duplo clique que restaura, teclado, mínimo e máximo) para um
   módulo reaproveitável, por exemplo `app/app/relatorio/_components/colunas-ajustaveis.ts(x)`
   ou um hook em `hooks/`. **Nada de copiar e colar o bloco**: uma segunda cópia diverge na
   primeira correção.
2. **Ligar esse módulo nas quatro tabelas de `RichReportSections.tsx`** (linhas ~338, ~488, ~603,
   ~729), começando pela de Anúncios Meta. Cada tabela guarda a largura com a própria chave, para
   uma não sobrescrever a outra.
3. **Ênfase na métrica também nessas tabelas**, do mesmo jeito da parte 1: a coluna da métrica
   prioritária da organização ganha destaque (peso maior e fundo suave). Se a tabela tiver um
   seletor próprio de ordenação, a ênfase acompanha a métrica prioritária, não a ordenação.
4. A primeira coluna dessas tabelas tem miniatura do criativo e duas linhas de texto: ao
   estreitar, o texto encurta com reticências em vez de empurrar a tabela.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- No celular a alça continua escondida e o arrastar-para-rolar (`DragScroll`) segue funcionando:
  a alça não pode virar rolagem nem ordenação.
- Testes que provam o recurso na tabela de Anúncios Meta, não só na de campanhas.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes. **Não crie
  fragmento novo em `.changes/`**: já existe `colunas-ajustaveis-no-relatorio.md`, edite-o se
  precisar, e ele tem no máximo 6 linhas.
- Commit na branch atual (`feat/colunas-ajustaveis`), sem push. **Não toque nos outros arquivos
  de `.changes/`**: eles estão sendo editados em paralelo.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
