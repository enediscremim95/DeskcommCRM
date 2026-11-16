-- Manual, fora de migrations. Executar somente após backup validado e aceite do Enedi.
-- Aplicação requer -v confirmado=sim. O padrão ensaia e faz ROLLBACK.
\set ON_ERROR_STOP on
\if :{?confirmado}
\else
\set confirmado nao
\endif
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
CREATE SCHEMA IF NOT EXISTS veritas_dedup;
REVOKE ALL ON SCHEMA veritas_dedup FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS veritas_dedup.snapshots (
 organization_id uuid NOT NULL, absorbed_id uuid PRIMARY KEY, survivor_id uuid NOT NULL,
 original jsonb NOT NULL, related_before jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA veritas_dedup FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION pg_temp.juntar_card(org uuid, vencedor uuid, absorvido uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE a public.crm_leads%rowtype; b public.crm_leads%rowtype; fk record; snapshots jsonb := '{}'; rows_before jsonb; has_org boolean; cross_org boolean;
BEGIN
 IF EXISTS(select 1 from veritas_dedup.snapshots where absorbed_id=absorvido) THEN RETURN; END IF;
 SELECT * INTO STRICT a FROM public.crm_leads WHERE id=vencedor AND organization_id=org FOR UPDATE;
 SELECT * INTO STRICT b FROM public.crm_leads WHERE id=absorvido AND organization_id=org FOR UPDATE;
 IF a.status <> 'open' OR b.status <> 'open' OR a.contact_id IS DISTINCT FROM b.contact_id
   OR a.pipeline_id <> b.pipeline_id OR a.id=b.id THEN RAISE EXCEPTION 'grupo_mudou_revisar'; END IF;
 -- Referências compostas exigem revisão: nunca arriscar cascade oculto.
 IF EXISTS(select 1 from pg_constraint where contype='f' and confrelid='public.crm_leads'::regclass and cardinality(conkey)<>1)
 THEN RAISE EXCEPTION 'referencia_composta_revisar'; END IF;
 FOR fk IN
  SELECT n.nspname ns,c.relname tab,at.attname col FROM pg_constraint co
  JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute at ON at.attrelid=co.conrelid AND at.attnum=co.conkey[1]
  WHERE co.contype='f' AND co.confrelid='public.crm_leads'::regclass AND c.relkind='r'
 LOOP
  EXECUTE format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from %I.%I t where %I=$1',fk.ns,fk.tab,fk.col) INTO rows_before USING absorvido;
  snapshots := snapshots || jsonb_build_object(fk.ns||'.'||fk.tab||'.'||fk.col,rows_before);
  select exists(select 1 from pg_attribute pa join pg_class pc on pc.oid=pa.attrelid
    join pg_namespace pn on pn.oid=pc.relnamespace where pn.nspname=fk.ns and pc.relname=fk.tab
    and pa.attname='organization_id' and pa.attnum>0 and not pa.attisdropped) into has_org;
  if has_org then
    execute format('select exists(select 1 from %I.%I where %I=$1 and organization_id is distinct from $2)',fk.ns,fk.tab,fk.col)
      into cross_org using absorvido,org;
    if cross_org then raise exception 'referencia_fora_da_org_revisar'; end if;
  end if;
  -- Estado de risco é CACHE derivado por lead, não a timeline. Conserva o do
  -- sobrevivente e arquiva integralmente o do absorvido em related_before.
  -- Se a tabela ganhar dependentes no futuro, aborta em vez de executar cascade.
  if fk.ns='public' and fk.tab='crm_lead_risk_states' and fk.col='lead_id'
    and exists(select 1 from public.crm_lead_risk_states where lead_id=vencedor and organization_id=org) then
    if exists(select 1 from pg_constraint where contype='f' and confrelid='public.crm_lead_risk_states'::regclass)
      then raise exception 'cache_risco_com_dependentes_revisar'; end if;
    delete from public.crm_lead_risk_states where lead_id=absorvido and organization_id=org;
    continue;
  end if;
  -- Colisão aborta A TRANSAÇÃO INTEIRA: nenhum descarte silencioso.
  EXECUTE format('update %I.%I set %I=$1 where %I=$2',fk.ns,fk.tab,fk.col,fk.col) USING vencedor,absorvido;
 END LOOP;
 -- Agendamento já existente mantém estado/cadência; só reponta o ID do card.
 -- Dois retornos ativos exigem revisão e abortam antes de qualquer consolidação.
 if exists(select 1 from public.cron_jobs where organization_id=org and job_kind='followup_turn' and enabled and payload->>'lead_id'=absorvido::text)
    and exists(select 1 from public.cron_jobs where organization_id=org and job_kind='followup_turn' and enabled and payload->>'lead_id'=vencedor::text)
 then raise exception 'retornos_ativos_concorrentes_revisar'; end if;
 select coalesce(jsonb_agg(to_jsonb(j)), '[]') into rows_before from public.cron_jobs j
 where organization_id=org and job_kind='followup_turn' and payload->>'lead_id'=absorvido::text;
 snapshots := snapshots || jsonb_build_object('cron_jobs.payload_lead_id',rows_before);
 update public.cron_jobs set payload=jsonb_set(payload,'{lead_id}',to_jsonb(vencedor::text),false),updated_at=now()
 where organization_id=org and job_kind='followup_turn' and payload->>'lead_id'=absorvido::text;
 -- Ponteiro polimórfico não é FK; preservar seu histórico também.
 SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') INTO rows_before FROM public.crm_lead_links t
 WHERE organization_id=org AND target_kind='lead' AND target_id=absorvido;
 snapshots := snapshots || jsonb_build_object('crm_lead_links.target_id',rows_before);
 UPDATE public.crm_lead_links SET target_id=vencedor WHERE organization_id=org AND target_kind='lead' AND target_id=absorvido;
 INSERT INTO veritas_dedup.snapshots VALUES(org,absorvido,vencedor,to_jsonb(b),snapshots,now());
 -- O card original inteiro (inclusive conflitos de campos/valor) permanece no snapshot.
 -- Etapa, status, responsável e valor do vencedor são conservados.
 UPDATE public.crm_leads SET
 tags=ARRAY(select distinct x from unnest(a.tags || b.tags) x),
 custom_fields=b.custom_fields || a.custom_fields,
 source_metadata=b.source_metadata || a.source_metadata || jsonb_build_object('dedup_archive','veritas_dedup.snapshots'),
 description=concat_ws(E'\n',nullif(a.description,''),nullif(b.description,'')),
 last_activity_at=greatest(a.last_activity_at,b.last_activity_at), updated_at=now()
 WHERE id=vencedor AND organization_id=org;
 DELETE FROM public.crm_leads WHERE id=absorvido AND organization_id=org;
END $$;
-- Usa a 0215 e seu hardening posterior, recusando referências residuais.
CREATE OR REPLACE FUNCTION pg_temp.juntar_contato(org uuid, vencedor uuid, absorvidos uuid[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 result:=public.fn_mesclar_contatos(org,vencedor,absorvidos);
 if coalesce(result->'nao_repontado','{}'::jsonb)<>'{}'::jsonb then
  raise exception 'contato_com_referencias_residuais_revisar';
 end if;
END $$;
-- O arquivo separado só contém pares explicitamente revisados.
\ir pares-revisados.sql
SELECT :'confirmado' = 'sim' AS aplicar \gset
\if :aplicar
COMMIT;
\else
ROLLBACK;
\endif
