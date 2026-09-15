# Security audit — dependencies

Two snapshots: prod-only (what the deployed app loads into the browser at runtime), and
all-dev (including build/test tools). pnpm 9.15.4 reads the same lockfile the CI and the
Docker image use, so the audit numbers below match what would land in production.

## Summary

| Package | Direct / transitive | Severity | Available fix | Action |
|---|---|---|---|---|
| `next` 14.2.35 | direct | 23 CVEs (2 low, 16 moderate, 5 high) | `>= 15.x` | **MAJOR MIGRATION REQUIRED** — see below |
| `postcss` 8.4.31 | transitive via `next` 14.x | 4 CVEs (2 moderate, 2 high) | `>= 8.5.23` | auto-fixed when next is bumped |
| `vite` 5.4.21 | transitive via `vitest` | 3 CVEs (2 moderate, 1 high) | `>= 6.4.3` | **MAJOR MIGRATION** chained with vitest |
| `vitest` 2.1.9 | direct | 2 CVEs (1 critical, 1 moderate) | `>= 3.2.6` or `>= 4.1.11` | **MAJOR MIGRATION** |
| `@vitest/mocker` 2.1.9 | transitive via `vitest` | 1 CVE (moderate) | `>= 4.1.11` | resolved by vitest major bump |
| `glob` 7.2.3 | transitive via `rimraf` 3 | 1 CVE (high) | `>= 12.0.0` | needs `rimraf` 4+ replacement |
| `glob` 10.3.10 | transitive via `@next/eslint-plugin-next` 14.x | 1 CVE (high) | `>= 10.5.0` | depends on next's ESLint plugin update |
| `esbuild` 0.28.2 | transitive via `tsx` | 1 CVE (moderate) | `>= 0.25.0` | **already satisfied** (audit is stale) |

No runtime vulnerability has a patch-level fix available in a `next@14.x` or
`vitest@2.x` series. Every remaining runtime CVE resolves only after a major version
bump, and most dev-transitive CVEs follow the same constraint.

## Applied

Nothing was force-bumped via pnpm overrides (the plan forbids them: an override that
masks incompatibilities is a worse problem than the CVE it hides). pnpm was pinned to
9.15.4 (lockfile-compatible with both pnpm 9 and 11) so local development, CI, and the
Docker image can never silently drift.

## Not applied — major migrations

The remaining CVEs all require upgrading one or more major versions. Each one needs a
dedicated PR with explicit migration notes; bundling them together (or hiding the bump
behind an override) is the failure mode this audit is meant to prevent.

### Next 14 → 15 (23 CVEs, 5 high)

Required to ship — also pulls the postcss fix along with it. Migration surface area:

- React 18 → 19 (Next 15 requires React 19).
- App Router behaviour: default `params` and `searchParams` are now async (`Promise<...>`).
  Every page that destructures these needs to await them.
- `next/image` import paths and behaviour changed slightly (typed `ImageProps`).
- Middleware matching changed for trailing slashes.
- New "Async Request APIs" affect every server component reading cookies/headers.

Requires running `pnpm next-codemod@canary next-async-request-api .` for a head start.

### Vitest 2 → 3 or 4 (2 CVEs, 1 critical in `@vitest/mocker`)

The critical CVE (`GHSA-82fw-gwwq-j7x9`, path traversal via mock redirect) only matters
when a project is running tests for code that mounts user-controlled redirect targets.
This project doesn't have that pattern, but a vigilant operator still wants the patch.

Vitest 3 and 4 both keep the 2.x-compatible config surface; the breaking changes are in
plugin / reporter APIs. A straight `pnpm vitest@^3` upgrade is the lower-risk option.

### Vite 5 → 6 (chained with vitest)

Same cycle: vitest 2.x peers vite 5.x, so bumping vite independently breaks the dev
script. Resolves itself once vitest is on 3.x.

### Glob 7.2.3 → 12 (transitive)

`rimraf@3` bundles glob 7.2.3. `rimraf@5` (the current major) bundles glob 10. Bumping
removes the 7.x vulnerable copy but pulls in a fresh set of changes — wait for a release
window where nothing else needs a major bump, or replace with `tinyglobby`.

### Glob 10.3.10 → 10.5.0 (transitive via `@next/eslint-plugin-next`)

Wait for `@next/eslint-plugin-next` 14.x to release a patch that pulls the newer glob,
or wait for the next major of the plugin (which comes with the Next 15 migration anyway).

## Verifying

```bash
pnpm audit --prod      # what's exposed at runtime
pnpm audit             # build/test tooling too
pnpm typecheck && pnpm test
docker compose up -d --build
```

After a major-version PR lands, run `pnpm audit` again — the row counts in the table
above should drop, not just shift around. A successful migration reduces the
vulnerability count; it doesn't just trade old CVEs for new ones in a different major.
