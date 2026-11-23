import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261123160001_0319_credencial_ia_padrao.sql", "utf8");
const baseline = readFileSync("supabase/baseline.sql", "utf8");

describe("contrato SQL da troca de credencial padrão", () => {
  it("entrega a mesma função no self-host e restringe a RPC ao backend", () => {
    expect(baseline).toContain(migration.trim());
    expect(migration).toMatch(/revoke execute[^;]+from public, anon, authenticated;/);
    expect(migration).toContain("role in ('owner', 'admin')");
  });

  it("insere uma nova versão e usa a publicação oficial antes de gravar a troca e a auditoria", () => {
    expect(migration).toMatch(/v_version.id := gen_random_uuid\(\);[\s\S]+v_version.status := 'draft';[\s\S]+insert into public.ai_agent_versions[\s\S]+perform public.fn_publish_ai_agent_version/);
    expect(migration).not.toMatch(/update public.ai_agent_versions|exception when/i);
    expect(migration).toMatch(/update public.ai_purpose_bindings[\s\S]+update public.organizations[\s\S]+insert into public.api_audit_log[\s\S]+insert into public.event_log \(organization_id, event_type, entity_kind/);
  });

  it("valida a revisão, o fornecedor, a capacidade do modelo e a disponibilidade na credencial", () => {
    expect(migration).toMatch(/p_revision is distinct from v_revision[\s\S]+provider = v_provider and model_id = p_model_id[\s\S]+model_id = any\(v_models_available\) and deprecated_at is null and supports_tools/);
  });
});
