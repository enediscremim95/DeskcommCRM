# HANDOFF: quem conecta o WhatsApp manda no WhatsApp dele

## Decisão do dono (24/09/2026, palavras dele)
"Quem conectar o WhatsApp no CRM precisa ter liberdade pra integrar tudo que quiser, inclusive o
MCP da IA conseguir visualizar as mensagens, históricos etc. Não pode ter nenhuma limitação, igual
qualquer outro CRM."

## O que JÁ existe (medido antes, para não reconstruir)
As ferramentas de conversa do MCP existem e funcionam: `crm_list_conversations`,
`crm_get_conversation`, `crm_get_conversation_history` (`lib/mcp/tools/conversations.ts`, pedem
`mcp:read` e papel `agent`) e `crm_send_whatsapp_message` (`mcp:write`). Nada a construir aqui.

## O que muda

1. **Reconectar o número deixa de ser privilégio.** `client_can_reconnect` passa a nascer `true`
   para `whatsapp`, do mesmo jeito que `client_visible` passou a nascer `true` no commit
   `2117f42`. Quem conectou o número é dono dele: lê o QR, reconecta quando cai, desliga se
   quiser. Fechar explicitamente continua possível para quem administra. **Já apliquei nos dados
   de produção (24 organizações); falta a causa, que é o padrão em código.**
   Atenção: existe `organization_integration_permissions_reconnect_check`, que só aceita
   `client_can_reconnect = true` na linha do `whatsapp`. Respeite a constraint, não a remova.
2. **A tela de Conexões não esconde ação de quem tem o número.** Varra a tela por condições que
   dependem de `is_platform_admin` para MOSTRAR botão de conectar, reconectar, desligar ou ver o
   estado da sessão, e troque por papel dentro da organização (`admin` da organização basta).
3. **Escrever isso na tela `/app/mcp`** (handoff `HANDOFF-tela-mcp.md`): a seção "o que a IA
   consegue fazer" precisa dizer, com todas as letras, que com token de leitura ela lê conversas e
   histórico do WhatsApp, e com token de escrita ela responde pelo número conectado.

## O que NÃO muda, e por quê
- **Contato que pediu para não ser incomodado continua fora de alcance.** A regra de opt-out
  (`lib/opt-out/deteccao.ts`) vale para humano, agente e MCP. Isso não é limitação de produto, é o
  que evita processo.
- **Apagar histórico continua exigindo o caminho de LGPD**, que registra quem pediu e quando.
- **Token é por pessoa e revogável**: liberdade de uso não é anonimato de uso. A auditoria do MCP
  (`lib/mcp/audit.ts`) continua registrando cada chamada.

## Regras (não negociáveis)
- Leia `CLAUDE.md`. Mudança de padrão em banco exige a tripla completa (migration + apêndice
  idempotente no `baseline.sql` + linha no MANIFEST), e a migration precisa ser **auto-curativa**:
  instalação antiga com a linha `false` que nunca foi tocada deve chegar ao padrão novo.
- Textos com `t()` e espanhol. **Sem travessão em texto visível.**
- Testes que provam: organização sem linha nenhuma permite reconectar o WhatsApp; fechar
  explicitamente continua valendo; e a tela de Conexões mostra as ações ao `admin` da organização.
- `pnpm typecheck`, lint dos arquivos tocados zerado, testes do recorte verdes.
- Fragmento em `.changes/` **curto, no máximo 4 linhas**. **Não toque nos outros arquivos de
  `.changes/`.**
- Commit na branch atual, sem push.
- **PROIBIDO ler ou procurar `.env` ou pastas de credenciais.**
