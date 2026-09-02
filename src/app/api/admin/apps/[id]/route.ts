import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

// Tell Next.js to never try to pre-render this at build time. The route is fully
// request-driven (reads body, authenticates, then writes to the DB), and Vercel's
// build will fail with "Failed to collect page data" if we don't.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Fields an admin is allowed to hand-correct. Editing any of these marks it as a manual
// override in Application.manualOverrides so the discovery pipeline never silently reverts it.
const EDITABLE_FIELDS = new Set([
  'name', 'shortDescription', 'category', 'subcategory', 'alternativesTo',
  'isNasFriendly', 'databases', 'installMethods', 'documentationUrl', 'demoUrl',
  'logoUrl', 'screenshotUrls', 'verificationStatus', 'approved', 'hidden', 'adminNotes',
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const app = await prisma.application.findUnique({ where: { id } });
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const update: Record<string, unknown> = {};
  const overrides = { ...((app.manualOverrides as Record<string, boolean> | null) ?? {}) };

  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    update[key] = value;
    // approved/hidden/adminNotes/verificationStatus are moderation state, not "facts"
    // the pipeline would otherwise try to re-derive — no need to lock those.
    if (!['approved', 'hidden', 'adminNotes', 'verificationStatus'].includes(key)) {
      overrides[key] = true;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  update.manualOverrides = overrides;

  const updated = await prisma.application.update({ where: { id }, data: update as any });
  return NextResponse.json({ ok: true, app: updated });
}
