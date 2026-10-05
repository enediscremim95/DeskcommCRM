import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const THUMBNAIL_TIMEOUT_MS = 3_000;
const THUMBNAIL_MAX_BYTES = 500 * 1024;
const THUMBNAIL_LIMIT = 12;

type Address = { address: string; family: number };
type LookupFn = (hostname: string) => Promise<Address[]>;
type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export type ThumbnailDependencies = {
  fetchFn?: FetchFn;
  lookupFn?: LookupFn;
};

async function withinTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("thumbnail_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map(Number);
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? numbers
    : null;
}

function isPublicIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const a = parts[0]!;
  const b = parts[1]!;
  const c = parts[2]!;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Words(address: string): number[] | null {
  let value = address.toLocaleLowerCase("en-US").split("%", 1)[0] ?? "";
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const ipv4 = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4) {
    const parts = ipv4Parts(ipv4);
    if (!parts) return null;
    value =
      value.slice(0, -ipv4.length) +
      `${(((parts[0] ?? 0) << 8) | (parts[1] ?? 0)).toString(16)}:` +
      `${(((parts[2] ?? 0) << 8) | (parts[3] ?? 0)).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
    ...right,
  ].map((word) => Number.parseInt(word || "0", 16));
  return words.length === 8 &&
    words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function isPublicIpv6(address: string): boolean {
  const words = ipv6Words(address);
  if (!words) return false;
  const [first, second] = words;
  // Aceita somente unicast global. Isso também barra loopback, link-local,
  // ULA, multicast, IPv4 mapeado e faixas que não devem receber SSRF.
  if (first == null || first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  if (first === 0x2001 && (second === 0 || second === 2 || second === 0x10)) return false;
  if (first === 0x2002) return false;
  return true;
}

export function isPublicThumbnailAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function hostnameIsPublic(hostname: string, lookupFn: LookupFn): Promise<boolean> {
  const normalized = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLocaleLowerCase("en-US");
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan")
  ) {
    return false;
  }
  if (isIP(normalized)) return isPublicThumbnailAddress(normalized);
  const addresses = await withinTimeout(lookupFn(normalized), THUMBNAIL_TIMEOUT_MS);
  return (
    addresses.length > 0 && addresses.every(({ address }) => isPublicThumbnailAddress(address))
  );
}

function imageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return png.every((byte, index) => bytes[index] === byte) ? "image/png" : null;
}

async function readLimitedBody(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > THUMBNAIL_MAX_BYTES) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > THUMBNAIL_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchPdfThumbnailDataUri(
  value: string,
  dependencies: ThumbnailDependencies = {},
): Promise<string | null> {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const lookupFn =
      dependencies.lookupFn ??
      (async (hostname) => lookup(hostname, { all: true, verbatim: true }));
    if (!(await hostnameIsPublic(url.hostname, lookupFn))) return null;
    const fetchFn = dependencies.fetchFn ?? fetch;
    const response = await fetchFn(url.toString(), {
      cache: "no-store",
      redirect: "manual",
      headers: { accept: "image/png,image/jpeg" },
      signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS),
    });
    if (!response.ok || response.status >= 300) return null;
    const bytes = await readLimitedBody(response);
    if (!bytes) return null;
    const mime = imageMime(bytes);
    if (!mime) return null;
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function preloadPdfThumbnails<T extends { thumbnail_url: string | null }>(
  rows: T[],
  dependencies: ThumbnailDependencies = {},
): Promise<Array<T & { thumbnail_data_uri: string | null }>> {
  const cache = new Map<string, Promise<string | null>>();
  return Promise.all(
    rows.map(async (row, index) => {
      if (!row.thumbnail_url || index >= THUMBNAIL_LIMIT) {
        return { ...row, thumbnail_data_uri: null };
      }
      let pending = cache.get(row.thumbnail_url);
      if (!pending) {
        pending = fetchPdfThumbnailDataUri(row.thumbnail_url, dependencies);
        cache.set(row.thumbnail_url, pending);
      }
      return { ...row, thumbnail_data_uri: await pending };
    }),
  );
}
