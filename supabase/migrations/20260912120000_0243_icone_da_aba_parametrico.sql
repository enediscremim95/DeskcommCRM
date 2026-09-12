-- A forma do ícone pertence à instalação, nunca à imagem Docker: uma imagem é
-- compartilhada por todos os revendedores. A lista é fechada para o renderer
-- não consumir SVG, URL ou outro texto controlado pelo operador.
alter table public.platform_branding
  add column if not exists icon_style text not null default 'letra';

alter table public.platform_branding
  drop constraint if exists platform_branding_icon_style;
alter table public.platform_branding
  add constraint platform_branding_icon_style check (icon_style in ('letra', 'atomo'));

comment on column public.platform_branding.icon_style is
  'Forma segura do ícone da aba: letra (fallback) ou atomo. O renderer desenha a forma localmente com accent_hex; nunca busca logo_url.';

revoke all on public.platform_branding from anon, authenticated;
grant select, insert, update on public.platform_branding to service_role;

notify pgrst, 'reload schema';
