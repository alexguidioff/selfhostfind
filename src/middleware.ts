import { NextRequest, NextResponse } from 'next/server';

// Edge-safe cookie presence check only (no crypto here — full HMAC verification happens
// in lib/auth.ts on the server for every admin page/route). This just avoids serving the
// admin UI at all with no cookie present.
const COOKIE_NAME = 'admin_session';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/admin/login' || pathname === '/api/admin/login') return NextResponse.next();

  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const hasCookie = req.cookies.has(COOKIE_NAME);
    if (!hasCookie) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/admin/login', req.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
