import { NextResponse } from 'next/server';
import { recordSearch } from '@/lib/search-log';
import { type SearchParams } from '@/lib/query';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Receives one event per explicit search submit from SearchBar.tsx. Disabled unless
// SEARCH_LOG_ENABLED=true: when disabled, returns 204 immediately so the client does not
// need to know. Validation lives in lib/search-log.ts (allowlist for filters, sensitive
// pattern rejection, query length cap, rate limit).

const MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: Request) {
  // Disabled? Refuse to do any work, including parsing the body, so a probe against
  // a misconfigured deploy can't even inflate metrics.
  if (process.env.SEARCH_LOG_ENABLED !== 'true') {
    return new NextResponse(null, { status: 204 });
  }

  const expectedOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || req.url).origin;
  if (req.headers.get('origin') !== expectedOrigin) {
    return NextResponse.json({ error: 'cross-origin' }, { status: 403 });
  }
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }
  let raw = '';
  const reader = req.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          void reader.cancel().catch(() => undefined);
          return NextResponse.json({ error: 'payload too large' }, { status: 413 });
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
    finally { reader.releaseLock(); }
  }

  let payload: unknown;
  if (raw.length > 0) {
    try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  }
  // The endpoint accepts only an object payload. null / numbers / strings are rejected
  // explicitly to avoid the previous "payload.q on null" TypeError.
  if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  const obj = (payload ?? {}) as { q?: unknown; filters?: unknown; context?: unknown };

  const q = typeof obj.q === 'string' ? obj.q : '';
  const filters = obj.filters && typeof obj.filters === 'object' && !Array.isArray(obj.filters)
    ? obj.filters : {};
  const params: SearchParams = {};
  for (const [k, v] of Object.entries(filters as Record<string, unknown>)) {
    if (typeof v === 'string') params[k] = v;
  }

  const outcome = await recordSearch({
    query: q,
    params,
    context: typeof obj.context === 'string' ? obj.context : null,
  });
  // 204 No Content must have an empty body per RFC 9110; NextResponse.json builds a JSON
  // payload which would throw. Use a 200 with the (small) JSON body instead so the client
  // can inspect the result without parsing errors.
  return NextResponse.json({ ok: outcome.recorded, reason: outcome.reason });
}
