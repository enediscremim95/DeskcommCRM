import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Rode via pnpm test:db");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
});

afterAll(async () => { await pool.end(); });

describe("atendimento automático no banco instalado", () => {
  it("canal novo nasce desligado", async () => {
    const org = randomUUID();
    const channel = randomUUID();
    await pool.query(
      "insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Teste','Teste')",
      [org],
    );
    const { rows } = await pool.query<{ automatic_attendance_enabled: boolean }>(
      `insert into channel_sessions
         (id, organization_id, waha_session_name, webhook_secret_encrypted)
       values ($1, $2, $1::text, '\\x00')
       returning automatic_attendance_enabled`,
      [channel, org],
    );
    expect(rows[0]?.automatic_attendance_enabled).toBe(false);
  });
});
