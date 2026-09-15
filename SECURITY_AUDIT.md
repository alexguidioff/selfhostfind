# Security audit — dependencies

Two sources, cross-checked:
- `pnpm audit` (against the GitHub Advisory DB) for what the tooling knows about.
- Direct queries against `api.github.com/advisories` and the project advisories pages for
  the **patched** versions (the GitHub Advisory API returns the vulnerable range but
  not always the patched one — only the upstream security advisory page does).

## Critical findings (online-verified 2026-09-14)

| GHSA | Package | Severity | Vulnerable range | Patched | Action |
|---|---|---|---|---|---|
| `GHSA-2xp9-vwfh-vxw4` | `next` | **CRITICAL (RCE)** Image Optimization with AVIF | `>= 10.0.0, < 15.5.24` | `15.5.24`, `16.3.3` | major bump required |
| `GHSA-p293-qw3h-jr36` | `next` | **CRITICAL (RCE)** Windows-hosted servers | `>= 13.4.0, < 15.5.24` | `15.5.24`, `16.3.3` | major bump required |
| `GHSA-5xrq-8626-4rwp` | `vitest` | **CRITICAL (RCE)** UI server arbitrary file read | `>= 4.0.0, < 4.1.0` | `4.1.11`, `5.0.0-rc.2` | major bump required |
| `GHSA-9crc-q9x8-hgqq` | `vitest` | **CRITICAL (RCE)** malicious site accessing Vitest UI | `>= 1.0.0, < 1.6.1` | per advisory | n/a (vitest 1.x); not relevant |
| `GHSA-89xv-2m56-2m9x` | `next` | HIGH SSRF in Server Actions on custom server | `>= 14.1.1, < 15.5.21` | `15.5.21+` | major bump required |
| `GHSA-p9j2-gv94-2wf4` | `next` | HIGH SSRF in rewrites via attacker-controlled host | `>= 12.0.0, < 15.5.21` | `15.5.21+` | major bump required |
| `GHSA-82fw-gwwq-j7x9` | `vitest`/`@vitest/mocker` | MEDIUM path traversal via mock redirect | `>= 2.1.0, < 4.1.11` | `4.1.11` | major bump required |

## Full pnpm audit (production-direct)

Same as previous report; 23 advisories on `next@14.2.35` (all resolved by `>= 15.5.24`),
4 on `postcss` (auto-fixed by the Next 15 bump).

## Full pnpm audit (all dependencies)

Same shape: nothing patch-applicable in the current major. Every fix requires:

| Package | Current | Fix available in same major? | Migration |
|---|---|---|---|
| `next` | 14.2.35 | no | `pnpm next@^15` + React 19 + Async Request APIs migration |
| `vitest` | 2.1.9 | no | `pnpm vitest@^3` (or `^4`) |
| `@vitest/mocker` | 2.1.9 | no | resolved by vitest major bump |
| `vite` | 5.4.21 | no | chained with vitest |
| `postcss` | 8.4.31 (transitive via next 14) | no (only 8.5.10+) | auto-fixed by next 15 |
| `glob` | 7.2.3 (transitive via rimraf 3) | no (12.0.0+) | bump `rimraf` to 4+ |
| `glob` | 10.3.10 (transitive via @next/eslint-plugin-next) | patch (10.5.0) but blocked | wait for next 15 |

## Why not force-upgrade anyway

Three CRITICAL-RCE CVEs in `next@14.x` that would still be live in production today if this
project shipped as-is. They are NOT patch-upgradable; the earliest fix is `next@15.5.24`.
The migration involves:

- React 18 → 19
- App Router: `params` and `searchParams` become async (`Promise<...>`)
- `next/image` typed props change
- Middleware matching behaviour changes
- New "Async Request APIs" affect every server component reading cookies/headers

Best done in its own PR with `pnpm next-codemod@canary next-async-request-api .` as a head
start and a real-browser smoke test of every page (not just `pnpm build`).

`vitest@2.x` has a critical path-traversal via the `vi.mock` redirect API. The project
doesn't `vi.mock` user-controlled paths today, but a developer adding that pattern
unwittingly inherits the CVE. Same migration shape: `pnpm vitest@^3` (or `^4`).

## Currently applied

- pnpm pinned to `9.15.4` (Phase 1). Lockfile is `9.0`-compatible with both pnpm 9 and 11.
- `SECURITY_AUDIT.md` exists as a single source of truth, updated after every audit run.
- No pnpm overrides introduced (the plan forbids them: an override that masks
  incompatibilities is a worse problem than the CVE it hides).

## Verifying

```bash
pnpm audit --prod      # what's exposed at runtime
pnpm audit             # build/test tooling too
pnpm typecheck && pnpm test
pnpm build
docker compose up -d --build
```

After a major-version PR lands, re-run both audits. A successful migration reduces the
vulnerability count; it doesn't just trade old CVEs for new ones in a different major.
