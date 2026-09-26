# HANDOFF: ajustar a largura das colunas e dar ênfase à métrica que importa

## O pedido, nas palavras do dono
"Eu quero um recurso aqui nessa etapa, igual o recurso da campanha do Meta, onde eu consigo pegar
a barra que divide as métricas e consigo arrastar ela e deixar mais justinho a tabela, e consigo
modelar e dar mais ênfase na métrica que eu achar melhor."

Ele mandou o print da tabela **Anúncios Meta** do Relatório: colunas Criativo, Investimento,
Impressões, Cliques, CTR, Leads, Custo/lead, Cliques па... A referência é o Gerenciador de
Anúncios do Meta, onde se arrasta a divisória no cabeçalho e a coluna encolhe ou estica.

## O que construir

1. **Divisória arrastável no cabeçalho de toda tabela do Relatório** (campanhas, conjuntos,
   anúncios: o mesmo componente serve as três). Pegar a linha que separa duas colunas, arrastar
   para o lado, a coluna assume a largura nova e o texto se acomoda. Largura mínima que não deixe
   o número ilegível; duplo clique na divisória volta ao automático daquela coluna.
2. **A largura fica salva para quem ajustou**, por organização, e volta igual na próxima visita.
   Preferir `localStorage` (é preferência de quem olha, não dado de negócio) para não exigir
   migration. Se decidir que tem de viver no banco, então a tripla completa da doutrina.
3. **Ênfase na métrica escolhida.** Já existe `PriorityMetricSelector` (métrica prioritária por
   organização). Ligue a ênfase a ela e deixe visível na tabela: a coluna da métrica em destaque
   ganha peso (número maior/negrito e fundo suave), e as outras continuam legíveis. Se der para
   escolher a ênfase direto no cabeçalho da coluna, melhor ainda: é onde a mão já está.
4. **Não quebrar o que existe:** ordenação por coluna, o menu de colunas (`ColumnPresetMenu`),
   as cores de custo (`CostThresholds`), o arrastar-para-rolar (`DragScroll`). O arrastar da
   divisória NÃO pode virar rolagem da tabela nem ordenação da coluna: a divisória é zona morta
   para esses dois.

## Onde
`app/app/relatorio/_components/TrafficDashboard.tsx` (o cabeçalho e as células vivem aí, perto da
linha 928 e 948), `ColumnPresetMenu.tsx`, `PriorityMetricSelector.tsx`.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- **Funciona no celular:** onde não há mouse, a divisória não atrapalha o toque nem a rolagem.
  Tabela larga em tela pequena continua rolando com o dedo.
- Testes que provam: arrastar muda a largura, a largura volta na próxima montagem, duplo clique
  reseta, arrastar a divisória não dispara ordenação, e a coluna em ênfase se distingue.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes. Fragmento em
  `.changes/` **curto, no máximo 6 linhas** (o changelog da VPS tem teto de bytes e já estourou).
- `git fetch` + merge da `origin/main` antes do commit. Commit na branch atual
  (`feat/colunas-ajustaveis`), sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
