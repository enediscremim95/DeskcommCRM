-- 0299: o painel de produtos vira a fonte dos campos comerciais do catálogo.
--
-- A URL original fica separada da URL pública do Storage. Sem essa memória, a
-- importação teria de baixar a mesma foto em toda execução.
alter table public.catalog_products
  add column if not exists legenda_atendimento text,
  add column if not exists imagem_origem_url text;

comment on column public.catalog_products.legenda_atendimento is
  'Complemento opcional escrito no CRM e acrescentado ao fim da legenda enviada ao cliente.';
comment on column public.catalog_products.imagem_origem_url is
  'URL recebida do painel na última foto baixada com sucesso; evita baixar novamente sem mudança.';

notify pgrst, 'reload schema';
