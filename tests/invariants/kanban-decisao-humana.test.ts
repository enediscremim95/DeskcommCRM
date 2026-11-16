import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
const container = process.env.TEST_DB_CONTAINER!;
function sql(input: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const org = "03060000-0000-4000-8000-000000000001";
const pipe = "03060000-0000-4000-8000-000000000002";
const first = "03060000-0000-4000-8000-000000000003";
const later = "03060000-0000-4000-8000-000000000004";
const lead = "03060000-0000-4000-8000-000000000005";
const lost = "03060000-0000-4000-8000-000000000006";
beforeAll(() =>
  sql(`
 insert into organizations(id,slug,legal_name,display_name) values('${org}','kanban-0306','Teste','Teste');
 insert into crm_pipelines(id,organization_id,name,slug) values('${pipe}','${org}','Teste','teste');
 insert into crm_stages(id,organization_id,pipeline_id,name,slug,position,is_lost) values
 ('${first}','${org}','${pipe}','Entrada','entrada',1000,false),('${later}','${org}','${pipe}','Contato','contato',2000,false),('${lost}','${org}','${pipe}','Perdidos','perdidos',3000,true);
 insert into crm_leads(id,organization_id,pipeline_id,stage_id,title) values('${lead}','${org}','${pipe}','${later}','Teste');
`),
);
const service = `set local role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',true);`;
describe("SQL protege etapa/status mesmo bypassando handlers", () => {
  it.each([
    `stage_id='${first}'`,
    "status='won',closed_at=now()",
    `stage_id='${lost}',lost_reason='no_response'`,
    `pipeline_id=gen_random_uuid()`,
  ])("serviço não altera %s", (patch) => {
    expect(() =>
      sql(`begin; ${service} update crm_leads set ${patch} where id='${lead}'; rollback;`),
    ).toThrow(/human_kanban_required/);
  });
  it("Perdidos não volta à entrada por serviço, inclusive via RPC em lote", () => {
    sql(`update crm_leads set stage_id='${lost}',lost_reason='no_response' where id='${lead}';`);
    expect(() =>
      sql(
        `begin; ${service} select * from fn_mover_leads_em_lote('${org}',array['${lead}'::uuid],'${first}'); rollback;`,
      ),
    ).toThrow(/human_kanban_required/);
    expect(sql(`select status from crm_leads where id='${lead}'`)).toBe("lost");
  });
  it("serviço só cria na entrada e pode atualizar metadados", () => {
    sql(
      `begin; ${service} insert into crm_leads(organization_id,pipeline_id,stage_id,title) values('${org}','${pipe}','${first}','Entrada automática'); update crm_leads set title='Metadados' where id='${lead}'; rollback;`,
    );
    expect(() =>
      sql(
        `begin; ${service} insert into crm_leads(organization_id,pipeline_id,stage_id,title) values('${org}','${pipe}','${later}','Inválido'); rollback;`,
      ),
    ).toThrow(/automation_entry_only/);
  });
});
