# HANDOFF (parte 4): selecionar campanhas e ver só as selecionadas

## O pedido do dono
Na tabela de campanhas do Relatório, poder **marcar campanhas como no Gerenciador do Meta** e
filtrar para ver somente as marcadas.

## O que construir
1. **Caixinha em cada linha de campanha** e uma no cabeçalho que marca e desmarca tudo o que está
   visível no filtro atual (Todas, Ativas, Pausadas). Marcar não pode disparar ordenação nem abrir
   o detalhamento da campanha: a caixinha é zona morta para esses dois.
2. **Barra de seleção**, aparecendo só quando há alguma marcada, com:
   - quantas estão marcadas;
   - o **resumo das marcadas**: investimento, conversões e custo por conversão somados (na moeda da
     conta, sem converter);
   - botão **"Ver só as selecionadas"**, que passa a mostrar apenas elas na tabela, e volta atrás;
   - botão **"Limpar seleção"**.
3. **A linha Total do rodapé soma o que está visível.** Com o filtro ligado, ela soma as
   selecionadas; sem ele, o período inteiro. A tabela nunca mostra um total que não corresponde às
   linhas acima dele.
4. **Os cards do topo e o funil continuam do período inteiro**, e a barra de seleção diz isso em
   uma frase curta. É decisão consciente: mudar os números do topo sem a pessoa pedir faria ela
   comparar períodos diferentes sem perceber. O resumo das selecionadas fica na própria barra.
5. **A seleção morre quando o contexto muda** (trocar período, plataforma ou organização). Seleção
   que sobrevive a uma troca de período é seleção mentirosa.
6. Marcar campanhas de **Meta e Google** é independente: cada tabela tem a sua seleção.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- Funciona no celular: a caixinha é clicável com o dedo, a barra de seleção não cobre a tabela
  inteira e o arrastar-para-rolar (`DragScroll`) continua funcionando.
- Acessível pelo teclado: dá para marcar com espaço, e a barra anuncia a contagem.
- Testes que provam: marcar uma linha não ordena nem expande; "marcar tudo" respeita o filtro de
  status; o total soma só o que está visível; trocar o período limpa a seleção; e o resumo da
  barra bate com a soma das linhas marcadas.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**. **Não toque nos outros arquivos de
  `.changes/`.**
- Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
