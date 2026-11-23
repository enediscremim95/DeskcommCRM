-- Completa as tarifas de referência de chamadas novas, em centavos de dólar por milhão.
-- OpenRouter Models API, consultada em 2026-11-23: https://openrouter.ai/api/v1/models
-- Para o slug original, prompt = USD 0,00000009 e completion = USD 0,00000018 por token.
-- Quando o cron já trouxe tarifas, preserva os valores sincronizados.
insert into public.ai_models
  (provider, model_id, display_name, context_window, input_price_per_million_cents,
   output_price_per_million_cents, supports_tools, source)
values ('openrouter', 'deepseek/deepseek-v4-flash', 'DeepSeek V4 Flash 0423', 1048576, 9, 18, true, 'openrouter')
on conflict (provider, model_id) do update
set input_price_per_million_cents = coalesce(ai_models.input_price_per_million_cents, excluded.input_price_per_million_cents),
    output_price_per_million_cents = coalesce(ai_models.output_price_per_million_cents, excluded.output_price_per_million_cents)
where ai_models.input_price_per_million_cents is null
   or ai_models.output_price_per_million_cents is null;

-- OpenAI, preços Standard conferidos em 2026-11-23:
-- https://developers.openai.com/api/docs/models/gpt-5.4-mini (USD 0,75 / 4,50)
-- https://developers.openai.com/api/docs/models/gpt-5-mini (USD 0,25 / 2,00)
insert into public.ai_models
  (provider, model_id, display_name, context_window, input_price_per_million_cents,
   output_price_per_million_cents, supports_tools)
values
  ('openai', 'gpt-5.4-mini', 'GPT-5.4 Mini', 400000, 75, 450, true),
  ('openai', 'gpt-5-mini', 'GPT-5 Mini', 400000, 25, 200, true)
on conflict (provider, model_id) do update
set input_price_per_million_cents = excluded.input_price_per_million_cents,
    output_price_per_million_cents = excluded.output_price_per_million_cents
where (ai_models.input_price_per_million_cents, ai_models.output_price_per_million_cents)
   is distinct from (excluded.input_price_per_million_cents, excluded.output_price_per_million_cents);
