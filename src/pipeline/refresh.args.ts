// Argument parsing for `pnpm refresh`. Extracted so the orchestration in refresh.ts
// stays focused on Prisma + GitHub + claim, and so the argument shape is unit-testable
// without spinning up a database.

const DEFAULT_MAX_REPOS = Number(process.env.REFRESH_MAX_REPOS ?? 50);

export interface ParsedArgs {
  dryRun: boolean;
  repo: string | null;
  max: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = false;
  let repo: string | null = null;
  let max = DEFAULT_MAX_REPOS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--preview') dryRun = true;
    else if (arg === '--repo' && argv[i + 1]) { repo = argv[++i]; }
    else if (arg === '--max' && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      max = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REPOS;
    }
  }
  return { dryRun, repo, max };
}
