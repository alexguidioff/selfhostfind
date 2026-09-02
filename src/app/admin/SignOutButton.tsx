'use client';

import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
    router.refresh();
  }
  return (
    <button onClick={signOut} className="text-sm text-slate-500 underline">
      Sign out
    </button>
  );
}
