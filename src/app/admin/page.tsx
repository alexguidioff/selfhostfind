import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { AdminAppRow } from './AdminAppRow';
import { SignOutButton } from './SignOutButton';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) redirect('/admin/login');

  const apps = await prisma.application.findMany({
    include: { repository: true },
    orderBy: [{ verificationStatus: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });

  const pendingCount = apps.filter((a) => a.verificationStatus === 'UNVERIFIED' && !a.hidden).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Admin — {pendingCount} pending review</h1>
        <SignOutButton />
      </div>

      <div className="space-y-2">
        {apps.map((app) => (
          <AdminAppRow key={app.id} app={app} />
        ))}
      </div>
    </div>
  );
}
