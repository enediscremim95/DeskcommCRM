import { describe, expect, it } from "vitest";

import { columnExists, sql } from "./gov-helpers";

const ORG = "fa298000-0000-4000-8000-000000000001";
const USER = "fa298000-1111-4000-8000-000000000001";
const TEMPLATE = "fa298000-2222-4000-8000-000000000001";
const MEDIA_PATH = `${ORG}/templates/${TEMPLATE}/imagem.jpg`;

describe("catálogo e atalhos com mídia", () => {
  it("instala as cinco colunas e as duas constraints do anexo", () => {
    for (const coluna of [
      "media_storage_path",
      "media_mime_type",
      "media_file_name",
      "media_size_bytes",
      "media_kind",
    ]) {
      expect(columnExists("message_templates", coluna)).toBe(true);
    }
    expect(
      Number(
        sql(`select count(*) from pg_constraint
             where conrelid='public.message_templates'::regclass
               and conname in ('message_templates_media_complete','message_templates_one_attachment');`),
      ),
    ).toBe(2);
  });

  it("cria o bucket público do catálogo com JPEG/PNG e teto de 5 MB", () => {
    expect(
      sql(`select public::text || '|' || file_size_limit::text || '|' || array_to_string(allowed_mime_types, ',')
             from storage.buckets where id='catalog-media';`),
    ).toBe("true|5242880|image/jpeg,image/png");
  });

  it("não aceita áudio e mídia no mesmo atalho", () => {
    const resultado = sql(`
      insert into auth.users (id, email) values ('${USER}', 'catalog-media@invariant.test')
        on conflict (id) do nothing;
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${ORG}', 'catalog-media-invariant', 'Catalog Media Invariant', 'Catalog Media')
        on conflict (id) do nothing;
      do $teste$ begin
        begin
          insert into public.message_templates (
            id, organization_id, title, body, created_by_user_id,
            audio_storage_path, audio_mime_type, audio_file_name, audio_size_bytes,
            media_storage_path, media_mime_type, media_file_name, media_size_bytes, media_kind
          ) values (
            '${TEMPLATE}', '${ORG}', 'Dois anexos', 'Teste', '${USER}',
            '${ORG}/templates/${TEMPLATE}/audio.ogg', 'audio/ogg', 'audio.ogg', 10,
            '${MEDIA_PATH}', 'image/jpeg', 'imagem.jpg', 10, 'image'
          );
          raise exception 'constraint_nao_bloqueou';
        exception when check_violation then null;
        end;
      end $teste$;
      select count(*) from public.message_templates where id='${TEMPLATE}';
    `);
    expect(resultado.split("\n").at(-1)).toBe("0");
  });

  it("enfileira a mídia antiga quando o atalho troca de anexo", () => {
    sql(`
      insert into auth.users (id, email) values ('${USER}', 'catalog-media@invariant.test')
        on conflict (id) do nothing;
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${ORG}', 'catalog-media-invariant', 'Catalog Media Invariant', 'Catalog Media')
        on conflict (id) do nothing;
      insert into public.message_templates (
        id, organization_id, title, body, created_by_user_id,
        media_storage_path, media_mime_type, media_file_name, media_size_bytes, media_kind
      ) values (
        '${TEMPLATE}', '${ORG}', 'Imagem', 'Teste', '${USER}',
        '${MEDIA_PATH}', 'image/jpeg', 'imagem.jpg', 10, 'image'
      ) on conflict (id) do update set
        audio_storage_path=null, audio_mime_type=null, audio_file_name=null, audio_size_bytes=null,
        media_storage_path=excluded.media_storage_path,
        media_mime_type=excluded.media_mime_type,
        media_file_name=excluded.media_file_name,
        media_size_bytes=excluded.media_size_bytes,
        media_kind=excluded.media_kind;
      update public.message_templates set
        media_storage_path=null, media_mime_type=null, media_file_name=null,
        media_size_bytes=null, media_kind=null
      where id='${TEMPLATE}';
    `);
    expect(
      Number(
        sql(`select count(*) from public.storage_redaction_queue
             where organization_id='${ORG}' and bucket='whatsapp-media'
               and object_path='${MEDIA_PATH}' and status='pending';`),
      ),
    ).toBe(1);
  });
});
