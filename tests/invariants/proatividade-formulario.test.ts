import { describe, it, expect } from "vitest";
import { sql } from "./gov-helpers";
const a = "03110000-0000-4000-8000-000000000001",
  b = "03110000-0000-4000-8000-000000000002";
const user = "03110000-0000-4000-8000-000000000003";
const lead = "03110000-0000-4000-8000-000000000004";
const pipe = "03110000-0000-4000-8000-000000000005";
const stage = "03110000-0000-4000-8000-000000000006";
const setup = `insert into organizations(id,slug,legal_name,display_name) values('${a}','proactive-a','Teste','Teste'),('${b}','proactive-b','Teste','Teste');
insert into auth.users(id,email) values('${user}','proactive@invariant.test');
insert into user_organizations(user_id,organization_id,role,accepted_at) values('${user}','${a}','agent',now());
insert into crm_pipelines(id,organization_id,name,slug) values('${pipe}','${b}','Teste','teste');
insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values('${stage}','${b}','${pipe}','Entrada','entrada',1000);
insert into crm_leads(id,organization_id,pipeline_id,stage_id,title) values('${lead}','${b}','${pipe}','${stage}','Sintético');`;
describe("tentativas duráveis de primeiro contato", () => {
  it("isola leitura de tentativas da outra organização", () => {
    const out = sql(
      `begin;${setup} insert into form_proactivity_attempts(organization_id,lead_id,phase) values('${b}','${lead}','whatsapp'); set local role authenticated; select set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);select count(*) from form_proactivity_attempts;rollback;`,
    );
    expect(out.split("\n").slice(-2, -1)[0]).toBe("0");
  });
  it("permite ler a tentativa da própria organização", () => {
    const out = sql(`begin;${setup}
      insert into user_organizations(user_id,organization_id,role,accepted_at) values('${user}','${b}','agent',now());
      insert into form_proactivity_attempts(organization_id,lead_id,phase) values('${b}','${lead}','whatsapp');
      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);
      select count(*) from form_proactivity_attempts;rollback;`);
    expect(out.split("\n").slice(-2, -1)[0]).toBe("1");
  });
  it("não aceita lead de outra org e não permite escrever pelo browser", () => {
    expect(() =>
      sql(
        `begin;${setup} insert into form_proactivity_attempts(organization_id,lead_id,phase) values('${a}','${lead}','whatsapp');rollback;`,
      ),
    ).toThrow();
    expect(
      sql(
        "select has_table_privilege('authenticated','public.form_proactivity_attempts','INSERT')",
      ),
    ).toBe("f");
    expect(
      sql("select has_table_privilege('anon','public.form_proactivity_attempts','SELECT')"),
    ).toBe("f");
  });
  it("um claim por fase e timeline transacional, sem alterar etapa/status", () => {
    const out = sql(
      `begin;${setup} insert into form_proactivity_attempts(organization_id,lead_id,phase) values('${b}','${lead}','whatsapp');update form_proactivity_attempts set outcome='failed' where organization_id='${b}';select count(*) from crm_lead_activities where organization_id='${b}' and source_module='form_proactivity';select status from crm_leads where id='${lead}';rollback;`,
    );
    expect(out).toContain("2\nopen");
    expect(() =>
      sql(
        `begin;${setup} insert into form_proactivity_attempts(organization_id,lead_id,phase) values('${b}','${lead}','whatsapp'),('${b}','${lead}','whatsapp');rollback;`,
      ),
    ).toThrow();
  });
});
