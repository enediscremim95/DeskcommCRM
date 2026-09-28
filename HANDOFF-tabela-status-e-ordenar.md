# HANDOFF: tabela de campanhas do Relatório com status, filtro e ordenação por coluna

**Pedido do dono (21/09/2026, 17:27),** com print da tabela de campanhas da referência "Kroebel OS"
(`C:\Users\gamer\Downloads\index.html`): colunas Campanha (com a marca embaixo), Origem, **Status** (seletor
"Ativa"), Investimento (cabeçalho em destaque com ▼), Impressões, Alcance, Cliques, CTR, CPC.
Palavras dele: "eu preciso conseguir filtrar por campanhas ativas e pausadas, nesse documento tem essa função
e eu gostei. Se eu clicar no nome da métrica, os dados são filtrados conforme a métrica que eu cliquei."
(Pelo print, "filtrados conforme a métrica" = **ordenados** por aquela coluna, com a seta indicando a direção.)

## Contexto
- Terceira etapa na MESMA branch `feat/relatorio-campanhas-e-paginas`, depois de
  `HANDOFF-relatorio-campanhas-e-paginas.md` (que passa a puxar do Windsor o status das campanhas:
  Meta `campaign_effective_status`, Google `campaign_status`) e de `HANDOFF-relatorio-mais-rico.md`.
- Tabela de campanhas: `CampaignTable` em `app/app/relatorio/_components/TrafficDashboard.tsx`, com colunas
  escolhíveis e predefinições (`ColumnPresetMenu`). Hoje não tem status, filtro nem ordenação.

## O que precisa (você decide a arquitetura)
1. **Coluna Status** na tabela de campanhas (Meta e Google): "Ativa" / "Pausada" (e outros estados do
   Windsor traduzidos para palavras simples, ex.: "Encerrada", "Em análise"), como selo discreto.
   É **leitura**: o CRM NÃO pausa nem ativa campanha (no print o status é um seletor editável; aqui não).
2. **Filtro de status** acima da tabela: Todas / Ativas / Pausadas, lembrado neste navegador.
3. **Ordenar clicando no nome da coluna**: clique ordena desc, segundo clique asc, com seta ▲/▼ e o cabeçalho
   ativo em destaque, acessível (`aria-sort`, botão no cabeçalho). Vale para todas as colunas numéricas e o
   nome. A linha Total fica sempre no rodapé, fora da ordenação. Conjuntos e anúncios abertos continuam
   debaixo da campanha deles.
4. Padrão ao abrir: ordenado por Investimento desc.
5. Vale para todas as organizações; cliente em "Somente leitura" usa filtro e ordenação normalmente.
6. Textos com `t()` e espanhol no `lib/i18n/dicionario.ts`. Sem nota explicativa.

Regras da casa: doutrina em `CLAUDE.md`, sem `console.log`, fragmento em `.changes/`, testes do recorte verdes,
`pnpm typecheck` e `pnpm lint` zerados, `git fetch` + merge da `origin/main` antes do commit. **PROIBIDO ler ou
procurar `.env` ou pastas de credenciais.**
