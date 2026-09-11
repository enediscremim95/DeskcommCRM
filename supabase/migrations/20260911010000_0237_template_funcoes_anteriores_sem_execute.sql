-- 0237: as implementações preservadas pelas migrations 0233/0235 são detalhe
-- interno do SECURITY DEFINER atual. Elas nunca foram uma RPC para sessão.
--
-- `ALTER FUNCTION ... RENAME` preserva os grants. A 0235 renomeou a função
-- recém-criada antes de revogar o grant herdado de authenticated; a 0236 apenas
-- carregou esse grant adiante. Revogamos as duas origens e todos os papéis de
-- chamada externa. A função atual continua sendo a única porta, exclusiva do
-- service_role; chamadas internas entre SECURITY DEFINER executam como o dono.
do $$
declare
  assinatura text;
begin
  foreach assinatura in array array[
    'public.fn_aplicar_template_de_organizacao_0233(uuid,uuid,jsonb)',
    'public.fn_aplicar_template_de_organizacao_0235(uuid,uuid,jsonb)'
  ] loop
    if to_regprocedure(assinatura) is not null then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', assinatura);
    end if;
  end loop;
end $$;
