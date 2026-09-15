import Link from 'next/link';
import type { SearchParams } from '@/lib/query';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { AdminAppRow } from './AdminAppRow';
import { SignOutButton } from './SignOutButton';

export const dynamic = 'force-dynamic';

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!(await isAdminAuthenticated())) redirect('/admin/login');

  const pendingOnly = (await searchParams).review !== 'all';
  const pendingWhere = { hidden: false, verificationStatus: 'UNVERIFIED' as const };
  const [apps, pendingCount] = await Promise.all([
    prisma.application.findMany({
      where: pendingOnly ? pendingWhere : {}, include: { repository: true },
      orderBy: [{ classificationConfidence: 'asc' }, { createdAt: 'desc' }], take: 100,
    }),
    prisma.application.count({ where: pendingWhere }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Admin — {pendingCount} pending review</h1>
        <SignOutButton />
      </div>

      <p className="text-sm mb-4"><Link href={pendingOnly ? '/admin?review=all' : '/admin'} className="underline">{pendingOnly ? 'Show all applications' : 'Show pending review'}</Link> · Showing up to 100 applications; reviewed apps leave the pending queue.</p>
      <div className="space-y-2">
        {apps.map((app) => (
          <AdminAppRow key={app.id} app={app} />
        ))}
      </div>
    </div>
  );
}
