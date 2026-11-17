import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
const container = process.env.TEST_DB_CONTAINER!;
function sql(input: string) {
 return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
// Tudo sintético e em rollback. Não consulta organizações ou contatos reais.
describe.each(Array.from({ length: 8 }, (_, i) => i + 1))("reserva SQL: organização %i", (n) => {
 const id = (suffix: number) => `03130000-0000-4000-8${n}00-${String(suffix).padStart(12, "0")}`;
 const org = id(1), contact = id(2), pipeline = id(3), stage = id(4), lead = id(5), event = id(6), otherEvent = id(7), channel = id(8);
 const phone = "+5541990000100";
 const setup = `begin;
 insert into organizations(id,slug,legal_name,display_name,settings) values('${org}','claim-${n}','Sintética','Sintética','{"capture_proactivity":{"enabled":true,"start_hour":0,"end_hour":24,"timezone":"UTC"}}');
 insert into contacts(id,organization_id,phone_number) values('${contact}','${org}','${phone}');
 insert into crm_pipelines(id,organization_id,name,slug) values('${pipeline}','${org}','Sintético','sintetico');
 insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values('${stage}','${org}','${pipeline}','Entrada','entrada',1000);
 insert into crm_leads(id,organization_id,pipeline_id,stage_id,contact_id,title,source_metadata) values('${lead}','${org}','${pipeline}','${stage}','${contact}','Teste','{"ai_starts_conversation":true}');
 insert into event_log(id,organization_id,event_type,entity_kind,entity_id,payload,metadata) values
 ('${event}','${org}','lead.created','crm_lead','${lead}','{}','{}'),('${otherEvent}','${org}','lead.created','crm_lead','${lead}','{}','{}');
 `;
 const claim = (e = event, o = org) => `public.fn_capture_contact_claim('${o}','${e}','${contact}','${phone}',array['${phone}'])`;
 it("reserva uma vez, retoma o mesmo evento e recusa outro/cross-tenant", () => {
   const output = sql(setup + `select ${claim()} = (extract(isodow from now() at time zone 'UTC')<=5);
 select ${claim()} = (extract(isodow from now() at time zone 'UTC')<=5);
 select ${claim(otherEvent)}; select ${claim(event, id(99))}; rollback;`);
   expect(output.split("\n")).toEqual(["t", "t", "f", "f"]);
 });
 it.each([
   "update contacts set is_blocked=true",
   "update contacts set consent='{\"marketing\":{\"declined_at\":\"2026-01-01\"}}'",
   "update crm_leads set source_metadata='{\"ai_starts_conversation\":false}'",
   "update crm_leads set source_metadata='{}'",
   "update organizations set settings='{}'",
 ])("nega antes de qualquer reserva: %s", (patch) => {
   expect(sql(setup + `${patch} where organization_id='${org}'; select ${claim()}; rollback;`.replace("update organizations set settings='{}' where organization_id", "update organizations set settings='{}' where id"))).toBe("f");
 });
 it("conversa ativa e mensagens recentes em alias bloqueiam", () => {
   const alias = id(9);
   const result = sql(setup + `insert into contacts(id,organization_id,phone_number) values('${alias}','${org}','+554190000100');
 insert into channel_sessions(id,organization_id,display_name,waha_session_name,status,webhook_secret_encrypted) values('${channel}','${org}','Teste','claim-${n}','WORKING','\\x00');
 insert into conversations(organization_id,contact_id,channel_session_id,status) values('${org}','${alias}','${channel}','open');
 select public.fn_capture_contact_claim('${org}','${event}','${contact}','${phone}',array['${phone}','+554190000100']); rollback;`);
   expect(result).toBe("f");
 });
 it("RPC não é executável por anon/authenticated e tabela tem RLS", () => {
   expect(sql(`select has_function_privilege('anon','public.fn_capture_contact_claim(uuid,uuid,uuid,text,text[])','EXECUTE') or has_function_privilege('authenticated','public.fn_capture_contact_claim(uuid,uuid,uuid,text,text[])','EXECUTE');`)).toBe("f");
   expect(sql("select relrowsecurity from pg_class where oid='public.capture_contact_claims'::regclass;")).toBe("t");
 });
});
