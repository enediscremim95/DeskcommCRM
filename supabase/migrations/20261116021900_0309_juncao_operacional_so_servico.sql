-- As funções de lote são ferramentas operacionais, chamadas por service_role.
-- Não há consumidor da sessão authenticated; o desfazer segue acessível ao gerente.
revoke execute on function public.fn_juntar_negocios_mesma_pessoa(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.fn_juntar_mesma_pessoa_da_organizacao(uuid, boolean) from public, anon, authenticated;
grant execute on function public.fn_juntar_negocios_mesma_pessoa(uuid, uuid, uuid) to service_role;
grant execute on function public.fn_juntar_mesma_pessoa_da_organizacao(uuid, boolean) to service_role;
notify pgrst, 'reload schema';
