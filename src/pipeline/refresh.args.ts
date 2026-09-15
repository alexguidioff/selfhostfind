export function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export interface ParsedArgs { dryRun: boolean; repo: string | null; max: number; }
export function parseArgs(argv: string[]): ParsedArgs {
  const fallback = positiveInt(process.env.REFRESH_MAX_REPOS, 50);
  let dryRun = false;
  let repo: string | null = null;
  let max = fallback;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--preview') dryRun = true;
    else if (arg === '--repo' && argv[i + 1]) repo = argv[++i];
    else if (arg === '--max' && argv[i + 1]) max = positiveInt(argv[++i], fallback);
    else throw new Error(`Unknown or incomplete refresh argument: ${arg}`);
  }
  if (repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('--repo requires owner/name');
  return { dryRun, repo, max };
}
