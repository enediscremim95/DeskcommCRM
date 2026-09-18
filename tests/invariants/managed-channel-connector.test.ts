import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

function novaOrg(slug: string): string {
  sql(`insert into public.organizations (slug, legal_name, display_name)
       values ('${slug}', 'inv 0247', 'inv 0247');`);
  return sql(`select id from public.organizations where slug = '${slug}'`).trim();
}

function inserirEvolution(org: string, phone: string): string {
  return sql(`
    insert into public.channel_sessions (
      organization_id, provider, waha_session_name, phone_number,
      webhook_secret_encrypted, evolution_base_url, evolution_instance_name,
      evolution_api_key_encrypted
    ) values (
      '${org}', 'evolution', null, '${phone}', '\\x00'::bytea,
      'https://connector.example', 'existing-instance', '\\x01'::bytea
    ) returning id;
  `).split("\n")[0]!.trim();
}

function erroDe(fn: () => unknown): string {
  try { fn(); } catch (cause) {
    const error = cause as { stderr?: Buffer | string; message?: string };
    return String(error.stderr ?? "") + String(error.message ?? "");
  }
  throw new Error("a operação proibida passou");
}

describe("0247 · conector WhatsApp gerenciado", () => {
  it("o baseline aceita a instância existente sem exigir sessão WAHA", () => {
    const org = novaOrg(`inv-0247-a-${Date.now()}`);
    const id = inserirEvolution(org, "5541999990001");
    expect(sql(`select provider || '|' || evolution_instance_name
                  from public.channel_sessions where id = '${id}'`))
      .toBe("evolution|existing-instance");
  });

  it("uma organização com WAHA ativo não recebe o conector gerenciado", () => {
    const org = novaOrg(`inv-0247-b-${Date.now()}`);
    sql(`insert into public.channel_sessions (
      organization_id, provider, waha_session_name, phone_number, webhook_secret_encrypted
    ) values ('${org}', 'waha', 'owned-session', '5541999990002', '\\x00'::bytea);`);
    expect(erroDe(() => inserirEvolution(org, "5541999990003"))).toMatch(/channel_connector_conflict/);
  });

  it("uma organização com conector gerenciado não abre sessão WAHA", () => {
    const org = novaOrg(`inv-0247-c-${Date.now()}`);
    inserirEvolution(org, "5541999990004");
    const error = erroDe(() => sql(`insert into public.channel_sessions (
      organization_id, provider, waha_session_name, phone_number, webhook_secret_encrypted
    ) values ('${org}', 'waha', 'forbidden-session', '5541999990005', '\\x00'::bytea);`));
    expect(error).toMatch(/channel_connector_conflict/);
  });

  it("o mesmo número não pode existir em dois conectores da organização", () => {
    const org = novaOrg(`inv-0247-d-${Date.now()}`);
    const phone = "5541999990006";
    inserirEvolution(org, phone);
    const error = erroDe(() => sql(`insert into public.channel_sessions (
      organization_id, provider, waha_session_name, phone_number,
      webhook_secret_encrypted, meta_phone_number_id
    ) values ('${org}', 'meta_cloud', null, '${phone}', '\\x00'::bytea, 'meta-id');`));
    expect(error).toMatch(/channel_sessions_phone_per_org_unique/);
  });

  it("permite três QR, barra o quarto e só zera depois de confirmar open", () => {
    const org = novaOrg(`inv-0247-e-${Date.now()}`);
    const session = inserirEvolution(org, "5541999990007");
    expect(sql(`
      select set_config('request.jwt.claims', '{"role":"service_role"}', false);
      do $test$
      declare r record; i integer;
      begin
        for i in 1..3 loop
          select * into r from public.fn_reserve_managed_channel_qr('${org}', '${session}');
          if not r.allowed or r.attempts <> i then raise exception 'tentativa_%_incorreta', i; end if;
          update public.channel_sessions set evolution_qr_last_requested_at = null where id = '${session}';
        end loop;
        select * into r from public.fn_reserve_managed_channel_qr('${org}', '${session}');
        if r.allowed or r.attempts <> 3 or r.retry_after_seconds <> 0 then raise exception 'quarta_tentativa_passou'; end if;
        perform public.fn_record_managed_channel_state('${org}', '${session}', 'open');
        if (select evolution_qr_attempt_count from public.channel_sessions where id = '${session}') <> 0 then
          raise exception 'contador_nao_zerou';
        end if;
      end $test$;
      select 'ok';
    `).split("\n").pop()).toBe("ok");
  });

  it("as RPCs de estado e QR não são executáveis por anon ou authenticated", () => {
    expect(sql(`select
      has_function_privilege('anon', 'public.fn_reserve_managed_channel_qr(uuid,uuid)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.fn_reserve_managed_channel_qr(uuid,uuid)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.fn_reserve_managed_channel_qr(uuid,uuid)', 'EXECUTE'),
      has_function_privilege('anon', 'public.fn_record_managed_channel_state(uuid,uuid,text)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.fn_record_managed_channel_state(uuid,uuid,text)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.fn_record_managed_channel_state(uuid,uuid,text)', 'EXECUTE');`))
      .toBe("f|f|t|f|f|t");
  });
});
