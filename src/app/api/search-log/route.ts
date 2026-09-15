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
  // Same-origin only: requests carrying the Origin header (browsers do, fetch() does)
  // must point back at us. Direct curl from a workstation is allowed (no Origin header)
  // because the rate limit + sensitive-pattern filter already keep it bounded.
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const here = new URL(req.url);
      const o = new URL(origin);
      if (o.host !== here.host) {
        return NextResponse.json({ error: 'cross-origin' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'bad origin' }, { status: 400 });
    }
  }

  // Cap the body so a malicious client can't make us process a multi-megabyte blob.
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }

  let payload: { q?: unknown; filters?: Record<string, unknown> };
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    }
    payload = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const q = typeof payload.q === 'string' ? payload.q : '';
  const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
  // We accept only string values here; the catalog validation lives in lib/search-log.ts.
  const params: SearchParams = {};
  for (const [k, v] of Object.entries(filters)) {
    if (typeof v === 'string') params[k] = v;
  }

  const outcome = await recordSearch({ query: q, params });
  // 204 No Content must have an empty body per RFC 9110; NextResponse.json builds a JSON
  // payload which would throw. Use a 200 with the (small) JSON body instead so the client
  // can inspect the result without parsing errors.
  return NextResponse.json({ ok: outcome.recorded, reason: outcome.reason });
}
