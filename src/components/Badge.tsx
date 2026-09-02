const VARIANTS = {
  default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  docker: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  arm: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  license: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  unverified: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  archived: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
};

export function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VARIANTS[variant]}`}>
      {children}
    </span>
  );
}
