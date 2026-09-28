# HANDOFF: tela "MCP" em Canais, a casa de "conecte a sua IA"

## O pedido do dono
Uma aba nova no menu lateral, dentro do grupo **Canais** (hoje: Conexões e Webhooks), chamada
**MCP**. Ao abrir, a pessoa encontra os dados de conexão e o que mais precisar para ligar a IA
dela ao CRM, sem depender de alguém explicar.

## Por que agora
Caso real de 24/09/2026: a pessoa recebeu o token por fora, colou no assistente de IA dela, e o
assistente **salvou o token num arquivo de texto no computador** e respondeu "não sei qual é o seu
sistema, qual é o site do seu CRM?". Ela ficou parada, e a chave de acesso ficou solta num `.txt`.
Token sem instrução não conecta ninguém.

## O que construir

### 1. A tela `/app/mcp`
Registrada em `lib/navigation/catalogo.ts`, grupo `canais` (o bloco começa na linha 447),
`sidebar: true`, rótulo **MCP**, descrição que cite "IA", "assistente" e "conectar" (a busca do
⌘K varre a descrição). Papel mínimo igual ao de quem pode criar token hoje
(`/app/settings/api-tokens`, linha 725): quem não pode criar token não tem o que fazer aqui.

Conteúdo, nesta ordem:

1. **Duas linhas em português simples** dizendo o que isso é: conectar um assistente de IA (Claude,
   ChatGPT e afins) a este CRM, para ele consultar e registrar coisas para você.
2. **Endereço do conector**, com botão de copiar: `<URL desta instalação>/api/mcp`.
   **A URL é resolvida da instalação, nunca digitada no código** (a mesma fonte que o link de
   convite usa). URL fixa quebraria em toda instalação que não é a nossa.
3. **Cabeçalho:** `Authorization: Bearer SEU_TOKEN`.
4. **No Claude Code (terminal)**, com botão de copiar:
   `claude mcp add --transport http crm <URL>/api/mcp --header "Authorization: Bearer SEU_TOKEN"`
5. **No aplicativo ou no site:** Configurações, Conectores, adicionar conector personalizado, com
   o mesmo endereço e o mesmo cabeçalho.
6. **O token:** atalho para criar um (a tela de tokens que já existe) e a lista dos tokens da
   organização que têm escopo de MCP, com nome, data e último uso, para a pessoa saber se aquele
   token já funcionou alguma vez. **Nunca mostrar o token de novo** (só existe no ato da criação).
7. **O que a IA vai conseguir fazer**, em frases, derivado dos escopos do token: leitura é
   consultar, escrita é registrar e alterar. Diga também o que ela NÃO faz.
8. **Teste de um minuto:** "peça ao seu assistente: liste meus últimos 5 leads".
9. **Segurança, curto e sem susto:** o token é a chave da casa, não guarde em arquivo de texto
   (fica salvo na configuração do conector), e se suspeitar de vazamento, revogue na tela de
   tokens e gere outro. Dizer que a revogação corta o acesso na hora.

### 2. A janela "Token criado" ganha o caminho
Em `app/app/settings/api-tokens/_components/ApiTokensClient.tsx` (o `Dialog` do `created`, por
volta da linha 257), abaixo do token: o endereço do conector, o comando com botão
**"Copiar comando"** (o botão copia **com o token dentro**; a tela mostra `SEU_TOKEN`), o aviso de
não guardar em arquivo de texto, e um link para `/app/mcp`. Esse bloco só aparece quando o token
tem escopo de MCP (`mcp:read` ou `mcp:write`).

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Vale o item 14 do Definition of Done: **tela nova tem porta** no registro de
  navegação, senão o CI reprova.
- Todo texto com `t()` e tradução para o espanhol no dicionário. **Sem travessão em texto visível.**
- Funciona no celular: comando longo quebra ou rola, não estoura a tela.
- Testes que provam: a tela existe e está no registro; o endereço mostrado vem da instalação e não
  de texto fixo; o bloco da janela do token só aparece com escopo de MCP; o botão de copiar comando
  entrega o token dentro; e a tela nunca imprime o token de um token já existente.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**. **Não toque nos outros arquivos de
  `.changes/`.**
- `git fetch` + merge da `origin/main` antes do commit. Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
