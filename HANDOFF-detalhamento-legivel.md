# HANDOFF (parte 5): o detalhamento tem que ler da esquerda, e parecer clicável

## O que está errado, com o print na mão
Ao abrir uma campanha, o conjunto e o anúncio aparecem com o nome à ESQUERDA e as métricas
empilhadas lá na DIREITA, em rótulos próprios ("GASTO", "CONVERSÕES", "CUSTO POR RESULTADO"), fora
do alinhamento das colunas da tabela. Efeito: o olho precisa atravessar a tela inteira para ligar
um nome ao seu número, e os números do detalhe não ficam sob os cabeçalhos a que correspondem.

Segundo problema: **não se percebe que dá para clicar.** A seta de abrir é discreta demais e nada
mais sinaliza que campanha, conjunto e anúncio abrem mais um nível.

## O que construir

### 1. O detalhe usa as colunas da tabela
Conjunto e anúncio passam a ser **linhas da mesma tabela**, com os valores nas MESMAS colunas da
campanha, cada número sob o seu cabeçalho. O recuo (e um traço ou ponto de hierarquia) mostra o
nível: campanha, conjunto, anúncio. Some o bloco flutuante à direita com rótulos próprios.

Quando o detalhe tiver menos métricas do que a campanha, a célula fica vazia, não inventa número
nem empurra a coluna. O botão "Ver anúncio" continua onde está, no fim da linha do anúncio.

### 2. Fica óbvio que abre
- A linha inteira do nome é clicável, com `cursor: pointer` e realce no passar do mouse.
- A seta gira ao abrir e tem contraste suficiente para ser vista.
- A linha diz o que há dentro, por exemplo "2 conjuntos" na campanha e "1 anúncio" no conjunto,
  como pista de que existe mais um nível. Onde não há nada dentro, não mostra seta.
- Acessível pelo teclado: foco visível, Enter e espaço abrem e fecham, com `aria-expanded`.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- **Não quebrar o que acabou de entrar nesta branch:** largura de coluna arrastável, ênfase na
  métrica prioritária, escolha de colunas por pessoa e seleção de campanhas. O detalhe obedece às
  MESMAS colunas escolhidas e às MESMAS larguras da tabela.
- Celular: a tabela continua rolando com o dedo e o recuo não empurra o nome para fora da tela.
- Testes que provam: o valor do conjunto e do anúncio cai na coluna certa; esconder uma coluna
  esconde também no detalhe; linha sem filhos não mostra seta; e abrir e fechar funciona pelo
  teclado.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**. **Não toque nos outros arquivos de
  `.changes/`.**
- Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
