import { assertDestinoResolvidoSeguro } from '@/lib/automation/outbound-ip';
import { assertSafeOutboundUrl } from '@/lib/automation/outbound-url';

const MAX_SITE_BYTES = 2 * 1024 * 1024;
const SITE_TIMEOUT_MS = 10_000;

function htmlParaTexto(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extrairTextoDeSite(sourceUrl: string): Promise<string> {
  assertSafeOutboundUrl(sourceUrl);
  const url = new URL(sourceUrl);
  await assertDestinoResolvidoSeguro(url.hostname);

  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(SITE_TIMEOUT_MS),
    headers: { Accept: 'text/html,text/plain;q=0.9' },
  });
  if (!response.ok) throw new Error(`site_http_${response.status}`);
  if (response.status >= 300 && response.status < 400) throw new Error('site_redirect_not_allowed');

  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_SITE_BYTES) throw new Error('site_too_large');
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.includes('text/html') && !type.includes('text/plain')) {
    throw new Error('site_unsupported_content_type');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_SITE_BYTES) throw new Error('site_too_large');
  const text = type.includes('text/html') ? htmlParaTexto(buffer.toString('utf8')) : buffer.toString('utf8').trim();
  if (text.length < 20) throw new Error('site_without_readable_text');
  return `Fonte: ${url.origin}${url.pathname}\n\n${text}`;
}
