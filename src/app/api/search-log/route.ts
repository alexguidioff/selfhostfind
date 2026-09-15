import { NextResponse } from 'next/server';
import { recordSearch, exceedsByteLimit } from '@/lib/search-log';
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

  // Same-origin only when the Origin header is present (browsers send it, fetch
  // doesn't always). Curl from a workstation with no Origin header is allowed because
  // the rate limit + sensitive-pattern filter still keep it bounded. The previous
  // version compared hosts only — checking scheme too avoids Origin: https://evil.com
  // leaking via mixed-content redirects on shared domains.
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const here = new URL(req.url);
      const o = new URL(origin);
      if (o.host !== here.host || o.protocol !== here.protocol) {
        return NextResponse.json({ error: 'cross-origin' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'bad origin' }, { status: 400 });
    }
  }

  // Reject based on declared Content-Length first — saves reading a giant body.
  // Chunked transfers come through without this header; we still re-check the body
  // length after reading.
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }

  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
  if (exceedsByteLimit(raw, MAX_BODY_BYTES)) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
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
