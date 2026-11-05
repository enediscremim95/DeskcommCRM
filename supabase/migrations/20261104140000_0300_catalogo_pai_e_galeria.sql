-- 0300: identidade do produto do painel e galeria ordenada por SKU pai.
create table if not exists public.catalog_product_groups (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  produto_codigo text not null,
  nome text not null,
  descricao text,
  acompanha text[] not null default '{}',
  categoria text,
  ativo boolean not null default true,
  origem text not null default 'painel',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, produto_codigo)
);
alter table public.catalog_product_groups enable row level security;
drop policy if exists catalog_product_groups_select on public.catalog_product_groups;
create policy catalog_product_groups_select on public.catalog_product_groups for select using (
  organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
);
drop policy if exists catalog_product_groups_write on public.catalog_product_groups;
create policy catalog_product_groups_write on public.catalog_product_groups
  using (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager')));
revoke all on public.catalog_product_groups from anon;
grant select, insert, update, delete on public.catalog_product_groups to authenticated;
grant all on public.catalog_product_groups to service_role;
drop trigger if exists trg_catalog_product_groups_updated_at on public.catalog_product_groups;
create trigger trg_catalog_product_groups_updated_at before update on public.catalog_product_groups
  for each row execute function public.fn_set_updated_at();

alter table public.catalog_products
  add column if not exists produto_codigo text,
  add column if not exists opcao_preco text;
-- Linhas legadas do painel não revelam o SKU pai. Não invente um grupo por
-- código de linha: o importador do retrato completo religa as linhas válidas e
-- desativa as linhas antigas que não existem mais no snapshot.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_products_product_group_fk' and conrelid = 'public.catalog_products'::regclass) then
    alter table public.catalog_products add constraint catalog_products_product_group_fk
      foreign key (organization_id, produto_codigo)
      references public.catalog_product_groups (organization_id, produto_codigo)
      on update cascade on delete set null;
  end if;
end $$;
create index if not exists catalog_products_org_parent_idx
  on public.catalog_products (organization_id, produto_codigo, ativo);

create table if not exists public.catalog_product_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  produto_codigo text not null,
  posicao smallint not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  source_hash text not null,
  imagem_origem_url text not null,
  created_at timestamptz not null default now(),
  constraint catalog_product_images_parent_fk foreign key (organization_id, produto_codigo)
    references public.catalog_product_groups (organization_id, produto_codigo) on update cascade on delete cascade,
  constraint catalog_product_images_position_check check (posicao between 1 and 9),
  constraint catalog_product_images_mime_check check (mime_type in ('image/jpeg', 'image/png')),
  constraint catalog_product_images_size_check check (size_bytes between 1 and 5242880),
  unique (organization_id, produto_codigo, posicao),
  unique (organization_id, produto_codigo, source_hash)
);
create index if not exists catalog_product_images_org_parent_idx
  on public.catalog_product_images (organization_id, produto_codigo, posicao);
alter table public.catalog_product_images enable row level security;
drop policy if exists catalog_product_images_select on public.catalog_product_images;
create policy catalog_product_images_select on public.catalog_product_images for select using (
  organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
);
drop policy if exists catalog_product_images_write on public.catalog_product_images;
create policy catalog_product_images_write on public.catalog_product_images
  using (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager')))
  with check (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager')));
revoke all on public.catalog_product_images from anon;
grant select, insert, update, delete on public.catalog_product_images to authenticated;
grant all on public.catalog_product_images to service_role;

create or replace function public.fn_sync_catalog_product_images(
  p_organization_id uuid,
  p_produto_codigo text,
  p_images jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 9 then
    raise exception 'catalog_gallery_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.catalog_product_groups
    where organization_id = p_organization_id and produto_codigo = p_produto_codigo
  ) then
    raise exception 'catalog_parent_not_found' using errcode = '23503';
  end if;

  delete from public.catalog_product_images
  where organization_id = p_organization_id and produto_codigo = p_produto_codigo;

  insert into public.catalog_product_images (
    organization_id, produto_codigo, posicao, storage_path, mime_type,
    size_bytes, source_hash, imagem_origem_url
  )
  select p_organization_id, p_produto_codigo, i.posicao, i.storage_path,
    i.mime_type, i.size_bytes, i.source_hash, i.imagem_origem_url
  from jsonb_to_recordset(p_images) as i(
    posicao smallint,
    storage_path text,
    mime_type text,
    size_bytes bigint,
    source_hash text,
    imagem_origem_url text
  );
end;
$$;
revoke execute on function public.fn_sync_catalog_product_images(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_sync_catalog_product_images(uuid, text, jsonb)
  to service_role;
comment on table public.catalog_product_groups is 'Identidade do produto no painel. O preco continua nas linhas vendaveis.';
comment on table public.catalog_product_images is 'Galeria ordenada do SKU pai, com no maximo nove imagens no catalog-media.';
comment on column public.catalog_products.produto_codigo is 'SKU pai do painel; nulo em itens manuais sem familia.';
comment on column public.catalog_products.opcao_preco is 'Rotulo das dimensoes que alteram o preco.';
notify pgrst, 'reload schema';
