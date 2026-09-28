-- Lead novo nasce sem e-mail. O opt-in pessoal continua disponível.
--
-- Decisão operacional de 25/09/2026: 28 leads x 3 pessoas produziram 84
-- e-mails num plano de 100/dia compartilhado com convite e recuperação de
-- senha. Alterar apenas a constante TypeScript deixaria inserts diretos e
-- clones self-host com o padrão antigo, por isso o default muda no schema.

alter table public.notification_email_preferences
  alter column new_lead set default false;

comment on column public.notification_email_preferences.new_lead is
  'Opt-in pessoal para e-mail de lead novo; desligado por padrão para preservar a cota transacional.';
