import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const ORG = "fa260000-0000-4000-8000-000000000001";
const USER = "fa260000-1111-4000-8000-000000000001";
const TEMPLATE = "fa260000-2222-4000-8000-000000000001";
const AUDIO_PATH = `${ORG}/templates/${TEMPLATE}/voz-antiga.ogg`;

describe("extensão do WhatsApp e áudio compartilhado", () => {
  it("mantém a política de tenant ligada a fn_user_org_ids nos dois lados", () => {
    const policies = Number(
      sql(`
      select count(*)
        from pg_policies
       where schemaname = 'public'
         and tablename = 'browser_extension_pairings'
         and cmd = 'ALL'
         and qual like '%organization_id%fn_user_org_ids%'
         and with_check like '%organization_id%fn_user_org_ids%';
    `),
    );
    expect(policies).toBe(1);
  });

  it("não entrega a tabela de pareamentos diretamente ao papel authenticated", () => {
    expect(
      sql(
        "select has_table_privilege('authenticated', 'public.browser_extension_pairings', 'SELECT,INSERT,UPDATE,DELETE');",
      ),
    ).toBe("f");
  });

  it("enfileira o objeto antigo quando o áudio compartilhado é removido", () => {
    sql(`
      insert into auth.users (id, email)
        values ('${USER}', 'extension-audio@invariant.test')
        on conflict (id) do nothing;
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${ORG}', 'extension-audio-inv', 'Extension Audio Invariant', 'Extension Audio')
        on conflict (id) do nothing;
      insert into public.message_templates (
        id, organization_id, title, body, created_by_user_id,
        audio_storage_path, audio_mime_type, audio_file_name, audio_size_bytes
      ) values (
        '${TEMPLATE}', '${ORG}', 'Voz compartilhada', 'Olá', '${USER}',
        '${AUDIO_PATH}', 'audio/ogg; codecs=opus', 'voz.ogg', 9
      ) on conflict (id) do update set
        audio_storage_path = excluded.audio_storage_path,
        audio_mime_type = excluded.audio_mime_type,
        audio_file_name = excluded.audio_file_name,
        audio_size_bytes = excluded.audio_size_bytes;

      update public.message_templates
         set audio_storage_path = null,
             audio_mime_type = null,
             audio_file_name = null,
             audio_size_bytes = null
       where id = '${TEMPLATE}';
    `);

    expect(
      Number(
        sql(`
        select count(*) from public.storage_redaction_queue
         where organization_id = '${ORG}'
           and bucket = 'whatsapp-media'
           and object_path = '${AUDIO_PATH}'
           and status = 'pending';
      `),
      ),
    ).toBe(1);
  });
});
