# Dependency security audit

Verified on 2026-09-16 against the npm registry, with the committed lockfile and pnpm 9.15.4.

## Result

| Scope | Before upgrade | After upgrade |
|---|---:|---:|
| All dependencies | 35 advisories: 3 critical, 12 high, 18 moderate, 2 low | **0** |
| Production dependencies | Included the affected Next and PostCSS versions | **0** |

Both `pnpm audit --json` and `pnpm audit --prod --json` exit successfully with empty
`advisories` and `muted` lists. This is a point-in-time dependency audit, not a guarantee
that the application has no security defects or that future advisories will remain absent.

## Resolved versions

| Package | Previous | Current |
|---|---|---|
| Next.js / eslint-config-next | 14.2.35 | 15.5.25 |
| React / React DOM | 18.3.1 | 19.3.0 |
| Vitest | 2.1.9 | 4.1.11 |
| Vite | 5.4.21 (transitive) | 7.3.6 (explicit compatible peer) |
| PostCSS used by Next | 8.4.31 | 8.5.28 |

React type packages were upgraded to version 19 and Node types to version 22.
Node **22.12+** is now required, matching the selected Vite engine requirement.
Prisma remains 5.22.0; this upgrade does not change the database schema.

## Why the scoped PostCSS override exists

Next 15.5.25 still declares PostCSS 8.4.31. Upgrading Next and Vitest alone left four
PostCSS advisories (two high, two moderate). The root `pnpm.overrides` entry
`next@15>postcss: $postcss` replaces only Next 15's copy with the already declared
PostCSS 8.5 range. This is a same-major API-compatible update, not an advisory exclusion.
The lockfile resolves it to 8.5.28; resolving PostCSS from Next's package confirms that
version. Production compilation and browser CSS checks validate this combination.

Remove the override when the selected Next release natively depends on a sufficiently
patched PostCSS version, then reinstall, audit and repeat the build checks. Do not remove
it merely because the direct PostCSS dependency is new: Next's nested copy was the issue.

References: [pnpm 9 overrides](https://pnpm.io/9.x/package_json#pnpmoverrides),
[PostCSS 8.5.28 release](https://github.com/postcss/postcss/releases/tag/8.5.28),
[Next image optimizer advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4),
[Vitest UI advisory](https://github.com/advisories/GHSA-5xrq-8626-4rwp),
[Vitest mocker advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

## Reproduce

Use the pinned pnpm version, run `pnpm install --frozen-lockfile`, then both audit
commands above. Run `pnpm typecheck`, all tests with an isolated `TEST_DATABASE_URL`,
and the production Docker build. Review login, logout, protected admin routes, search,
comparison, application details and CSS after any future framework update.

## Upgrade validation

- 139 tests passed across 17 files, without skips, on Node 22 in the Docker worker
  against disposable PostgreSQL 16; the migration tests cover UTC daily snapshots.
- TypeScript and the production Docker build passed; the image builds without a database.
- Browser checks covered search aggregation, application details, comparison, mobile CSS,
  login/logout and the protected statistics page. Category, capability, alternative and
  sitemap endpoints returned HTTP 200.
- Login/logout now use a full navigation after the session cookie changes, avoiding a
  prefetched unauthenticated redirect. Regression check: visit `/admin/search-stats`
  while signed out, sign in and confirm `/admin` opens; sign out, revisit the statistics
  URL and confirm it redirects to `/admin/login`.
