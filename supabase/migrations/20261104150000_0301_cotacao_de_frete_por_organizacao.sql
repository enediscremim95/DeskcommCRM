-- 0301: cotação de frete opt-in por organização e embalagem do catálogo.
--
-- A credencial nunca fica ao alcance do navegador. A tabela nasce sem policy e
-- sem privilégio para anon/authenticated; somente a service_role a acessa.
create table if not exists public.organization_shipping_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'melhor_envio',
  base_url text not null,
  user_agent text not null,
  origin_postal_code text not null,
  token_ciphertext bytea not null,
  service_allowlist integer[] not null default '{}',
  declared_value_mode text not null default 'subtotal',
  packaging_margin_cents integer not null default 0,
  local_postal_ranges text[] not null default '{}',
  ativo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_shipping_settings_provider_check
    check (provider = 'melhor_envio'),
  constraint organization_shipping_settings_origin_postal_code_check
    check (origin_postal_code ~ '^[0-9]{8}$'),
  constraint organization_shipping_settings_declared_value_mode_check
    check (declared_value_mode in ('subtotal', 'zero')),
  constraint organization_shipping_settings_packaging_margin_check
    check (packaging_margin_cents >= 0)
);

alter table public.organization_shipping_settings enable row level security;
revoke all on public.organization_shipping_settings from anon, authenticated;
grant all on public.organization_shipping_settings to service_role;

drop trigger if exists trg_organization_shipping_settings_updated_at
  on public.organization_shipping_settings;
create trigger trg_organization_shipping_settings_updated_at
  before update on public.organization_shipping_settings
  for each row execute function public.fn_set_updated_at();

comment on table public.organization_shipping_settings is
  'Configuração write-only de cotação de frete por organização; nenhuma policy entrega a credencial ao navegador.';
comment on column public.organization_shipping_settings.token_ciphertext is
  'Token cifrado com lib/crypto/aes_gcm, empacotado como versão + IV + tag + ciphertext.';

alter table public.catalog_products
  add column if not exists peso_kg numeric(7,3),
  add column if not exists altura_cm numeric(6,1),
  add column if not exists largura_cm numeric(6,1),
  add column if not exists comprimento_cm numeric(6,1),
  add column if not exists embalagem_estimada boolean not null default true;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'catalog_products_embalagem_positiva'
       and conrelid = 'public.catalog_products'::regclass
  ) then
    alter table public.catalog_products
      add constraint catalog_products_embalagem_positiva check (
        (peso_kg is null or peso_kg > 0)
        and (altura_cm is null or altura_cm > 0)
        and (largura_cm is null or largura_cm > 0)
        and (comprimento_cm is null or comprimento_cm > 0)
      );
  end if;
end $$;

comment on column public.catalog_products.peso_kg is
  'Peso da caixa ou kit inteiro desta opção, nunca de uma unidade solta.';
comment on column public.catalog_products.embalagem_estimada is
  'Verdadeiro até uma ação explícita futura confirmar peso e medidas reais.';

notify pgrst, 'reload schema';
