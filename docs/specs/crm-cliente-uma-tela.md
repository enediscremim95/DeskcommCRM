# CRM do cliente em uma tela

## Decisão

O formulário em `/admin/tenants/new` envia `delivery_mode: credentials`.
Nome, perfil do negócio, fuso, relatório e interface do responsável são configurados juntos.
O trigger existente semeia o funil; a criação grava `onboarded_at`, sem fabricar aceite de termos.
Não configura WhatsApp nem publica um agente de IA sem credenciais. A branch de IA opcional permanece independente.

`organizations.settings.business_profile` é a fonte de descrição, site HTTP(S), telefone,
endereço e horários, validada por `lib/schemas/business-profile.ts`. A tela
`/app/settings/tenant` lê e altera esses dados preservando demais configurações.

Senha gerada por `randomBytes(24)`, não exposta ao administrador. Entra direto no CRM;
a troca pelo link de recuperação /login/forgot é recomendada, não imposta. Isso atende à entrada
sem etapas extras, com o custo deliberado de a senha ficar no e-mail até o titular trocá-la.
Conta já existente não sofre reset nem vínculo silencioso: recebe convite e usa a senha atual.

## Contrato e falhas

- POST `/api/v1/admin/tenants` mantém idempotência e convite legado (`delivery_mode: invite`, padrão da API).
- `owner_access`: `status` (sent, already_sent, existing_user, failed), `login_url`, `retryable`.
- GET/POST `/api/v1/admin/tenants/:id/owner-access`: consulta/retoma envio. Exige administrador full e MFA quando devida.
- `tenant_owner_access` é exclusiva do service role, RLS ligada, sem grants para anon/authenticated.
- Lease de dois minutos impede provisionamentos concorrentes. Queda após criação Auth recupera a conta
  por marcador em `app_metadata`, sem redefinir senha. Outro cadastro concorrente vira convite na retentativa.
- Senha pendente cifrada em AES-GCM, chave derivada de INTERNAL_SECRET com domínio próprio e AAD da organização.
  Ciphertext removido quando envio é aceito. Rotacionar INTERNAL_SECRET invalida pendências antigas:
  usar a recuperação de senha existente para a conta já criada, sem tentar reset automático.
- Ausência de remetente/chave de e-mail retorna falha visível antes de criar conta Auth.
  Reconfigurar o e-mail da instalação e tentar novamente no detalhe da organização.
- `sent` significa que o serviço aceitou o envio, não que a mensagem chegou à caixa de entrada.
  Se o destinatário não a localizar, usar a recuperação de senha do login; não há reexposição da senha.
- Após um convite aceito pelo serviço, nova emissão segue pela tela Equipe se expirar.
- Não há envio externo nem aplicação em produção durante a implementação.

## Sistema vivo

Entrada: formulário NewTenantForm e guard requirePlatformAdmin.
Saídas: perfil em TenantForm, vínculo em user_organizations, funil semeado e e-mail.
Registro: tenant.created_by_platform_admin e tenant.owner_access_dispatched em auditoria;
convite reaproveita member.invited.
Portas: lista administrativa > Nova organização e detalhe da organização > OwnerAccessStatus.
Anti-morte: estado persistente consultável, botão de retentativa e lease com prazo.
Configuração: formulário inicial e Configurações > Organização; e-mail usa variáveis já existentes.
Continuidade IA/humano: perfil pronto para operação humana; não publica nem liga IA.
Retorno de erro: falha mantém pendência e ciphertext, libera lease; nova tentativa consulta estado atual.
Mapa: `docs/architecture/crm-cliente-uma-tela.architecture.json`.

## Validação em tela

1. Administrador full abre Organizações > Nova organização.
2. Preenche nome, e-mail novo, site, descrição e fuso; clica Criar organização.
3. Confere status de envio. Sem e-mail configurado, abre Ver organização, recarrega e tenta novamente;
   só uma organização deve existir.
4. Em ambiente de teste com e-mail configurado, usa o acesso recebido: deve entrar no CRM sem wizard,
   ver o funil e conferir os dados em Configurações > Organização.
5. Salva alteração no site e recarrega. Repete com e-mail que já tenha conta: recebe convite,
   mantém senha anterior e só ganha vínculo ao aceitar.

Prova automatizada em banco/navegador depende de Docker e Supabase local. A spec existente
`organizacoes-criacao-convite-e-cache.spec.ts` cobre perfil, falta de SMTP, retentativa e legado.
Testes unitários não comprovam entrega real de e-mail nem aplicação da migration.

## Arquivos da implementação

- Criação: `app/admin/(protected)/tenants/new/_form.tsx`, `hooks/useCreateTenant.ts`,
  `lib/schemas/tenant-creation.ts`, `app/api/v1/admin/tenants/route.ts`.
- Retentativa: `app/api/v1/admin/tenants/[id]/owner-access/route.ts`,
  `components/admin/tenants/OwnerAccessStatus.tsx`, `app/admin/(protected)/tenants/[id]/_client.tsx`.
- Provisionamento/e-mail: `lib/auth/provision-owner-access.ts`, `lib/auth/owner-access-secret.ts`,
  `lib/email/templates/owner-access.ts`, `lib/email/resend.ts`, `lib/audit/actions.ts`.
- Perfil: `lib/schemas/business-profile.ts`, `lib/schemas/settings.ts`,
  `app/actions/settings/updateTenant.ts`, `app/app/settings/tenant/{page,_form}.tsx`.
- Tradução: `lib/i18n/dicionario.ts`.
- Banco: `supabase/migrations/20260917120000_0244_entrega_acesso_dono.sql`,
  `supabase/baseline.sql`, `supabase/migrations/MANIFEST.md`.
- Testes: `tests/unit/{provision-owner-access,owner-access-route,owner-access-secret-and-profile,organizacoes-criacao-e-troca}.test.ts`,
  `components/admin/tenants/OwnerAccessStatus.test.tsx`, `tests/invariants/tenant-owner-access.test.ts`,
  `tests/e2e/organizacoes-criacao-convite-e-cache.spec.ts`.
- Documentação: este contrato, mapa de arquitetura e índice, mapa de jornadas e
  `.changes/crm-cliente-uma-tela.md`.

## Evidência local

Build de produção concluído. Typecheck passou; lint sem erros (avisos existentes no repositório).
47 testes direcionados de acesso/UI/traduções/compatibilidade/release passaram; mais 5 de locale
e 11 de ordem do baseline/MANIFEST passaram após ajustes.
Suíte completa: 796 arquivos, 792 aprovados e 4 com falha; 8.464 testes aprovados, 16 falhas e 1 falha esperada. Entre elas, 12 falhas em `leads-import-route` e
`rascunho-superado-nao-e-regravado`, reproduzidas numa extração limpa da main `28965ae6`.
Outras 4 falhas nos dois arquivos `lgpd-pdf-*.test.ts` também foram reproduzidas na mesma main: PDF.js rejeita o caminho Windows `standard_fonts\`. Não são classificadas como corrigidas.

`test:db` não iniciou porque não existe Docker. Playwright recusou iniciar sem `.env.e2e`
e Supabase local. Nenhuma senha/e-mail real foi usado como teste. Migration, isolamento em banco,
login real com credenciais recebidas e regeneração de tipos a partir do schema real permanecem
sem prova local; não houve aplicação em produção.
