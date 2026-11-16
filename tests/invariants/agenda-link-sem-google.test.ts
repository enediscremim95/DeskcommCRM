import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleHttpError } from "@/lib/agenda/google/transport";
import { fallbackAppointmentToJitsi, googleDestinationUsable, recordGoogleConnectionFailure, GOOGLE_EXPIRED_MESSAGE } from "@/lib/agenda/google/fallback";
import { gerarJitsiVideoUrl } from "@/lib/agenda/jitsi";
import { pgComoSupabase } from "../pg-como-supabase";

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set, rode via pnpm test:db");
const pool = new pg.Pool({ host: "127.0.0.1", port: Number(process.env.TEST_DB_PORT ?? 54329), user: "postgres", password: "postgres", database: "postgres" });
const db = pgComoSupabase(pool);
const org = "a3060000-0000-4000-8000-000000000001";
const owner = "a3060000-0000-4000-8000-000000000002";
const contact = "a3060000-0000-4000-8000-000000000003";
const connection = "a3060000-0000-4000-8000-000000000004";

async function appointment(url: string, locationKind = "google_meet") {
  const id = randomUUID();
  await pool.query(
    `insert into calendar_appointments(id,organization_id,contact_id,owner_user_id,title,starts_at,ends_at,status,location_kind,meeting_state,meeting_request_id,meeting_url,meeting_ready_at)
     values($1,$2,$3,$4,'Consulta',now()+interval '1 day',now()+interval '1 day 1 hour','confirmed',$5,'ready',gen_random_uuid(),$6,now())`,
    [id, org, contact, owner, locationKind, url],
  );
  return id;
}

beforeAll(async () => {
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1,'agenda-0308','Agenda 0308','Agenda 0308') on conflict do nothing", [org]);
  await pool.query("insert into auth.users(id,email) values($1,'owner-0308@example.test') on conflict do nothing", [owner]);
  await pool.query("insert into user_organizations(user_id,organization_id,role) values($1,$2,'admin') on conflict do nothing", [owner, org]);
  await pool.query("insert into contacts(id,organization_id,display_name) values($1,$2,'Vitória') on conflict do nothing", [contact, org]);
});
afterAll(() => pool.end());

describe("agenda continua sem o Google", () => {
  it("sem conexão cria compromisso confirmado e Jitsi pronto", async () => {
    expect(await googleDestinationUsable(db, org, owner)).toBe(false);
    const url = gerarJitsiVideoUrl("Consulta Vitória");
    const id = await appointment(url);
    const row = (await pool.query("select status,meeting_state,meeting_url from calendar_appointments where id=$1", [id])).rows[0];
    expect(row).toEqual({ status: "confirmed", meeting_state: "ready", meeting_url: url });
  });

  it("401 preserva o compromisso, expira a conexão e materializa Jitsi", async () => {
    await pool.query("insert into calendar_connections(id,organization_id,user_id,provider,account_email,status) values($1,$2,$3,'google_calendar','owner-0308@example.test','healthy') on conflict(id) do update set status='healthy',last_sync_error=null", [connection, org, owner]);
    const id = randomUUID();
    await pool.query(`insert into calendar_appointments(id,organization_id,contact_id,owner_user_id,title,starts_at,ends_at,status,location_kind) values($1,$2,$3,$4,'Retorno',now()+interval '2 days',now()+interval '2 days 1 hour','confirmed','google_meet')`, [id, org, contact, owner]);
    await recordGoogleConnectionFailure(db, { organizationId: org, connectionId: connection, error: new GoogleHttpError(401), operation: "atualizar" });
    await fallbackAppointmentToJitsi(db, org, id, "Retorno");
    const row = (await pool.query("select status,meeting_state,meeting_url from calendar_appointments where id=$1", [id])).rows[0];
    const conn = (await pool.query("select status,last_sync_error from calendar_connections where id=$1", [connection])).rows[0];
    expect(row.status).toBe("confirmed");
    expect(row.meeting_state).toBe("ready");
    expect(row.meeting_url).toMatch(/^https:\/\/meet\.jit\.si\//);
    expect(conn).toEqual({ status: "token_expired", last_sync_error: GOOGLE_EXPIRED_MESSAGE });
  });

  it("Google saudável mantém o caminho Meet disponível", async () => {
    await pool.query("update calendar_connections set status='healthy' where id=$1", [connection]);
    await pool.query(
      "insert into calendar_connection_calendars(id,organization_id,connection_id,external_calendar_id,name,is_destination,available,access_role) values($1,$2,$3,'agenda-0308','Agenda',true,true,'owner') on conflict do nothing",
      [randomUUID(), org, connection],
    );
    expect(await googleDestinationUsable(db, org, owner)).toBe(true);
    const meet = "https://meet.google.com/abc-defg-hij";
    const meetId = await appointment(meet);
    expect((await pool.query("select meeting_url from calendar_appointments where id=$1", [meetId])).rows[0].meeting_url).toBe(meet);
  });

  it("sala Jitsi pronta nunca é substituída pelo caminho Google", async () => {
    const jitsi = gerarJitsiVideoUrl("Sala preservada");
    const jitsiId = await appointment(jitsi);
    await fallbackAppointmentToJitsi(db, org, jitsiId, "Outra sala");
    expect((await pool.query("select meeting_url from calendar_appointments where id=$1", [jitsiId])).rows[0].meeting_url).toBe(jitsi);
  });
});
