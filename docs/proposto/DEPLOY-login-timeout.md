# Proposta: preservar sessão durante indisponibilidade do Auth

CONFIRMADO no código: GET /user usa até três tentativas, com pausas de 150 e 300 ms.
504, timeout e rede não viram visitante: o proxy responde 503 sem emitir cookies;
as APIs usam 503 com Retry-After. Sessão ausente e 401/403 continuam recusados.
Não há alteração de schema. Nenhum deploy ou build de imagem foi executado nesta tarefa.

Após revisão e publicação da imagem pelo fluxo de CI, executar na VPS, usando a tag
imutável publicada para esta correção (substituir o placeholder):

```bash
bash scripts/deploy-com-rollback.sh --session login-timeout-correcao --tag <tag-publicada-da-correcao>
```

Rollback explícito para a versão anterior:

```bash
bash scripts/deploy-com-rollback.sh --session login-timeout-rollback --tag 1.6.0-veritas.157
```

O script chama o porteiro de produção e reverte automaticamente se a verificação falhar.
Não executar enquanto outra sessão de deploy estiver ativa.

Validação operacional pendente: simular indisponibilidade do Auth no navegador,
confirmar ausência de redirecionamento e de exclusão de cookies, restaurar o serviço
e tentar novamente na mesma sessão. E2E/validação visual não foram executados neste
worktree: Docker e banco foram expressamente vedados pelo solicitante.

Limite: as pausas são curtas, mas cada chamada ainda está sujeita ao timeout do
upstream. Três respostas de 10s podem levar aproximadamente 30,45s até o 503.
Não há aceite de JWT local como substituto da validação pelo servidor.

Sistema Vivo: entrada = getUser; saída = gates de página/API; registro = log de
indisponibilidade sem dados pessoais; superfície = 503 ou erro recuperável da página;
próximo passo = nova tentativa com backoff e ação de tentar novamente. Não adiciona
configuração nem modifica continuidade de atendimento ou schema.

Contrato HTTP: `503 {"error":{"code":"service_unavailable","message":"…"}}`
com `Retry-After: 1`. O consumidor deve permitir nova tentativa, preservando sua sessão.
`401 unauthenticated` permanece reservado à ausência ou recusa confirmada da sessão.

## Validação local

Dependências: `pnpm-lock.yaml` comparado byte a byte com o worktree
`deskcommcrm-lento-fase2`; dependências reutilizadas somente por symlink local.
Nenhum processo pausado foi retomado.

```bash
node_modules/.bin/vitest run --environment node --maxWorkers=1 --no-file-parallelism --no-cache lib/auth lib/supabase/server-auth-cookies.test.ts tests/unit/auth-getuser-erro-mudo.test.ts tests/unit/auth-falha-alto.test.ts tests/unit/require-role-mfa.test.ts tests/unit/auth-timeout-gates.test.ts tests/unit/auth-confirm-recusa-nomeia-a-causa.test.ts
node_modules/.bin/vitest run --environment node --maxWorkers=1 --no-file-parallelism --no-cache lib/auth/get-user-com-backoff.test.ts lib/supabase/server-auth-cookies.test.ts
```

Resultado: 125 testes distintos em 21 arquivos aprovados, considerando suíte e
reteste. A primeira execução ampla teve 122 aprovados e três falhas no mock de
ambiente do novo teste de cookies (faltava `NEXT_PUBLIC_APP_URL`). Corrigido o mock,
o reteste aprovou os três casos de cookies e os 15 casos do helper.

Contraprova após commit: devolver o resultado de erro ao esgotar o backoff, em vez
de lançar indisponibilidade, causou exatamente os sete vermelhos previstos
(504/503/rede/timeout/erro desconhecido). Código restaurado e 15/15 casos do helper
novamente aprovados.

ESLint dos arquivos alterados: zero erros; um aviso preexistente de variável `user`
não utilizada em `app/api/v1/conversations/[id]/media/route.ts`. Reteste de lint do
mock corrigido também sem erros. `git diff --check` aprovado.

Typecheck completo tentado com
`node_modules/.bin/tsc --noEmit -p tsconfig.typecheck.json --incremental false`.
Interrompido após mais de dez minutos, ainda sem resultado, sob carga elevada da
máquina (processo com aproximadamente 2 GB de RAM). Não há aprovação de typecheck
nem de E2E nesta entrega; esses gates continuam pendentes antes do deploy.
