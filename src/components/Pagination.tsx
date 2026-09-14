import Link from 'next/link';
import type { SearchParams } from '@/lib/query';

export function Pagination({ page, pages, params, pathname = '/' }: {
  page: number; pages: number; params: SearchParams; pathname?: string;
}) {
  if (pages <= 1) return null;
  function href(nextPage: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    query.set('page', String(nextPage));
    return `${pathname}?${query}`;
  }
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-6 mt-6 text-sm">
      {page > 1 && <Link className="underline" href={href(page - 1)}>← Previous page</Link>}
      <span>Page {page} of {pages}</span>
      {page < pages && <Link className="underline" href={href(page + 1)}>Next page →</Link>}
    </nav>
  );
}
