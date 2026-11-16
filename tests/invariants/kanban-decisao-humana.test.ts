import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
const container = process.env.TEST_DB_CONTAINER!;
function sql(input: string) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const org = "03060000-0000-4000-8000-000000000001";
const pipe = "03060000-0000-4000-8000-000000000002";
const first = "03060000-0000-4000-8000-000000000003";
const later = "03060000-0000-4000-8000-000000000004";
const lead = "03060000-0000-4000-8000-000000000005";
const lost = "03060000-0000-4000-8000-000000000006";
const ahead = "03060000-0000-4000-8000-000000000007";
beforeAll(() => sql(`
 insert into organizations(id,slug,legal_name,display_name) values('${org}','kanban-0306','Teste','Teste');
 insert into crm_pipelines(id,organization_id,name,slug) values('${pipe}','${org}','Teste','teste');
 insert into crm_stages(id,organization_id,pipeline_id,name,slug,position,is_lost) values
 ('${first}','${org}','${pipe}','Entrada','entrada',1000,false),('${later}','${org}','${pipe}','Contato','contato',2000,false),('${lost}','${org}','${pipe}','Perdidos','perdidos',3000,true),('${ahead}','${org}','${pipe}','Proposta','proposta',2500,false);
 insert into crm_leads(id,organization_id,pipeline_id,stage_id,title) values('${lead}','${org}','${pipe}','${later}','Teste');
`));
const service = `set local role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',true);`;
describe("SQL: serviço só avança a etapa (0312), mesmo bypassando handlers", () => {
  it("serviço não volta etapa (nem à entrada)", () => {
    expect(() => sql(`begin; ${service} update crm_leads set stage_id='${first}' where id='${lead}'; rollback;`)).toThrow(/kanban_only_forward/);
  });
  it.each(["status='won',closed_at=now()", `pipeline_id=gen_random_uuid()`, `stage_id='${lost}',lost_reason='other',lost_reason_detail='Teste descartável'`])("serviço não altera %s", (patch) => {
    expect(() => sql(`begin; ${service} update crm_leads set ${patch} where id='${lead}'; rollback;`)).toThrow(/human_kanban_required/);
  });
  it("serviço avança para etapa de posição maior e segue só o avanço", () => {
    sql(`begin; ${service} update crm_leads set stage_id='${ahead}' where id='${lead}'; rollback;`);
    sql(`update crm_leads set stage_id='${ahead}' where id='${lead}';`);
    expect(() => sql(`begin; ${service} update crm_leads set stage_id='${later}' where id='${lead}'; rollback;`)).toThrow(/kanban_only_forward/);
    expect(sql(`select stage_id from crm_leads where id='${lead}'`)).toBe(ahead);
    sql(`update crm_leads set stage_id='${later}' where id='${lead}';`);
  });
  it("Perdidos não volta por serviço, inclusive via RPC em lote", () => {
    sql(`update crm_leads set stage_id='${lost}',lost_reason='other',lost_reason_detail='Teste descartável' where id='${lead}';`);
    expect(() => sql(`begin; ${service} select * from fn_mover_leads_em_lote('${org}',array['${lead}'::uuid],'${first}'); rollback;`)).toThrow(/human_kanban_required/);
    expect(() => sql(`begin; ${service} update crm_leads set stage_id='${ahead}' where id='${lead}'; rollback;`)).toThrow(/human_kanban_required/);
    expect(sql(`select status from crm_leads where id='${lead}'`)).toBe("lost");
    // humano (conexão administrativa direta) continua livre
    sql(`update crm_leads set stage_id='${first}' where id='${lead}';`);
    expect(sql(`select status from crm_leads where id='${lead}'`)).toBe("open");
    sql(`update crm_leads set stage_id='${later}' where id='${lead}';`);
  });
  it("serviço só cria na entrada e pode atualizar metadados", () => {
    sql(`begin; ${service} insert into crm_leads(organization_id,pipeline_id,stage_id,title) values('${org}','${pipe}','${first}','Entrada automática'); update crm_leads set title='Metadados' where id='${lead}'; rollback;`);
    expect(() => sql(`begin; ${service} insert into crm_leads(organization_id,pipeline_id,stage_id,title) values('${org}','${pipe}','${later}','Inválido'); rollback;`)).toThrow(/automation_entry_only/);
  });
});
