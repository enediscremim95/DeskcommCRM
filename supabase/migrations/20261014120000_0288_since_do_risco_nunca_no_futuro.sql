-- 0288, o instante de início do risco nunca pode superar a própria detecção.
--
-- A agenda pode classificar um negócio ainda fresco como `em_voo` (compromisso
-- futuro/em andamento) ou `critico` (presença vencida). O escritor calculava o
-- `since` exclusivamente pela janela de silêncio. Assim, para um lead tocado há
-- 1h num estágio de 24h, gravava `last_activity_at + 24h`, isto é, 23h depois da
-- detecção, e o CHECK correto `since <= detected_at` recusava a linha.
--
-- O TypeScript corrige a origem e limita o início à detecção. Este trigger é a
-- última defesa no relógio do banco: elimina a deriva de segundos entre Node e
-- Postgres e protege qualquer outro escritor da tabela sem afrouxar o CHECK.

create or replace function public.fn_carimba_detected_at()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $function$
begin
  new.detected_at := now();
  if new.since > new.detected_at then
    new.since := new.detected_at;
  end if;
  new.updated_at := now();
  return new;
end$function$;

comment on function public.fn_carimba_detected_at() is
  'Carimba a detecção no relógio do banco e limita since ao mesmo instante: agenda/presença podem forçar um bucket antes do limiar de silêncio, mas um estado nunca começa depois de ser detectado.';
