-- Botão mestre pessoal de notificações por e-mail.
-- As preferências por categoria permanecem intactas quando o mestre é desligado.

alter table public.notification_email_preferences
  add column if not exists email_enabled boolean not null default true;

comment on column public.notification_email_preferences.email_enabled is
  'Barreira pessoal para qualquer e-mail de notificação; não altera as escolhas por categoria.';
