const url = process.argv[2] ?? "http://127.0.0.1:3000/api/v1/health";
const segredo = process.env.INTERNAL_CRON_SECRET || process.env.INTERNAL_SECRET || "";

try {
  const response = await fetch(url, {
    headers: {
      "x-self-heal-probe": "1",
      ...(segredo ? { authorization: `Bearer ${segredo}` } : {}),
    },
    cache: "no-store",
  });
  const body = await response.json();
  process.exitCode = body?.data?.checks?.supabase?.status === "ok" ? 0 : 1;
} catch {
  process.exitCode = 1;
}
