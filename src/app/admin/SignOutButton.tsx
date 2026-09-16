'use client';

export function SignOutButton() {
  async function signOut() {
    await fetch('/api/admin/logout', { method: 'POST' });
    // Reload after the cookie changes so prefetched routes cannot reuse the old session.
    window.location.replace('/admin/login');
  }
  return (
    <button onClick={signOut} className="text-sm text-slate-500 underline">
      Sign out
    </button>
  );
}
