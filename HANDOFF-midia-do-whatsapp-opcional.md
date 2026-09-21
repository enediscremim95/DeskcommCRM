# HANDOFF: parar de guardar os arquivos de mídia do WhatsApp

**Pedido do dono (21/09/2026, 13:34):** "sobre as mídias, essas a gente não precisa colocar no CRM,
precisamos só das infos escritas, por enquanto."

## Estado medido por Claude (21/09/2026, v1.6.0-veritas.27)

- Supabase no plano **grátis**: 1 GB de Storage. O bucket `whatsapp-media` já tem 403 arquivos,
  **171 MB** (17% do limite), e cresce a cada cliente que conecta WhatsApp. O banco tem 165 MB de 500 MB.
- Todo arquivo recebido é baixado e gravado: evento `media.persist_requested` →
  `workers/media-persist-worker.ts` (baixa do WAHA e grava no bucket, preenche
  `media_storage_path`/`media_size_bytes` em `messages`). `workers/media-derive-worker.ts` deriva
  texto da mídia (transcrição de áudio etc.).
- Não há nenhuma opção (env nem tela) para desligar a gravação.

## O que precisa

Você decide a arquitetura; o que o dono precisa:

1. **Por padrão, o CRM não guarda mais o arquivo** (foto, áudio, vídeo, documento) no Storage. A
   mensagem continua registrada com o que é texto: legenda, tipo da mídia, nome do arquivo,
   horário, e um aviso claro na conversa ("foto recebida, arquivo não guardado" ou equivalente).
2. **Não perder informação escrita que vem da mídia.** Se hoje o áudio vira texto (transcrição) e
   isso alimenta a conversa ou o agente, avalie manter a transcrição processando o arquivo de forma
   transitória (baixa, extrai o texto, descarta), sem gravar o binário. Se isso não for viável sem
   gravar, escreva a troca no fragmento para o dono decidir.
3. "Por enquanto": deixe um jeito de religar no futuro (ajuste por organização, controlado por quem
   administra a plataforma), com padrão **desligado** para todas as organizações, inclusive as que
   já existem.
4. **Não apagar** os 171 MB que já estão guardados nesta entrega. Apagar é decisão separada do dono.
5. Vale para todas as organizações. Se precisar de schema: tripla de migration (migration +
   apêndice idempotente no `baseline.sql` + MANIFEST), RLS e os dois `revoke` em função nova de
   `public`. Política de banco com `organization_id in (select public.fn_user_org_ids())`; a forma
   `= any(...)` é recusada pelo Postgres.
6. A tela de conversa e a ficha do lead não podem quebrar com mensagem de mídia sem arquivo
   (sem miniatura quebrada, sem erro de URL assinada).

Regras da casa: doutrina em `CLAUDE.md`, auditoria, Zod, sem `console.log`, fragmento em
`.changes/`, testes do recorte verdes, `pnpm typecheck` e `pnpm lint` zerados. **PROIBIDO ler ou
procurar `.env` ou pastas de credenciais.**
