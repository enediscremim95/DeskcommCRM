-- A 0314 corrigiu o catálogo, mas a tarifa legada de orçamento ficou em 150/600.
-- A tarifa Standard oficial em 2026-11-23 é USD 0,25 / 2,00 por milhão de tokens:
-- https://developers.openai.com/api/docs/models/gpt-5-mini
-- Usa o valor já validado em ai_models para manter as duas tabelas de acordo.
insert into public.ai_pricing as p
  (model, prompt_cents_per_million_tokens, completion_cents_per_million_tokens, notes)
select model_id, input_price_per_million_cents, output_price_per_million_cents, 'catálogo 0314'
  from public.ai_models
 where provider = 'openai' and model_id = 'gpt-5-mini'
on conflict (model) do update
set prompt_cents_per_million_tokens = excluded.prompt_cents_per_million_tokens,
    completion_cents_per_million_tokens = excluded.completion_cents_per_million_tokens,
    notes = excluded.notes
where (p.prompt_cents_per_million_tokens, p.completion_cents_per_million_tokens)
   is distinct from (excluded.prompt_cents_per_million_tokens, excluded.completion_cents_per_million_tokens);
