# Dependency audit

Verified using `pnpm audit --json` against the npm registry on 2026-09-15. This is the installed lockfile audit, not a proof that every advisory is exploitable in this deployment.

The command exits 1 because advisories remain. Reported totals: **3 critical, 12 high, 18 moderate, 2 low**. Counts are package/advisory entries; the same advisory can affect multiple packages.

## Decisions and exposure

- **Next 14.2.35:** runtime dependency. The registry reports patched releases in Next 15, with the latest listed minimum 15.5.24. A Next major migration remains a separate, outstanding task; this branch does not claim to fix these advisories. The Windows-specific advisory does not apply to the Linux Docker image. Images in this app use `unoptimized`; this reduces use of the optimizer but is not a substitute for upgrading or a proof that its endpoint is unreachable.
- **Vitest 2.1.9, Vite, esbuild and mocker:** development/test dependencies. The critical Vitest advisory concerns a listening UI server; CI runs `vitest run`, not a public UI server. Both Vitest advisories need to be considered when selecting an upgrade (3.2.6 fixes the critical issue; the registry lists 4.1.11 for the mocker issue).
- **PostCSS:** the direct dependency is newer, but Next includes an older copy. Its fixes are in the same PostCSS major; updating the direct declaration alone does not replace Next's bundled dependency. Check the resolved graph after the Next upgrade.
- **glob:** the affected installed copy is transitive development tooling. The advisory concerns CLI `--cmd` execution. Version 10.5.0 is a same-major fix; use a compatible dependency update rather than claim every finding requires a major.

No runtime dependency upgrades or forced overrides were applied in this completion commit. Framework/test-runner major migrations remain outstanding; do not describe this branch as having a clean security audit. Keep deployment exposure and dependency remediation separate from the functional test result.

## Registry evidence

| Package | Entries |
|---|---:|
| `@vitest/mocker` | 1 |
| `esbuild` | 1 |
| `glob` | 1 |
| `next` | 23 |
| `postcss` | 4 |
| `vite` | 3 |
| `vitest` | 2 |

The following ranges and severities are copied from the registry response obtained by the command above. They supersede the earlier report's unsupported ranges and RCE labels.

| Package | Advisory | Severity | Vulnerable | Patched |
|---|---|---|---|---|
| `esbuild` | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | moderate | `<=0.24.2` | `>=0.25.0` |
| `glob` | [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) | high | `>=10.2.0 <10.5.0` | `>=10.5.0` |
| `next` | [GHSA-9g9p-9gw9-jx7f](https://github.com/advisories/GHSA-9g9p-9gw9-jx7f) | moderate | `>=10.0.0 <15.5.10` | `>=15.5.10` |
| `next` | [GHSA-h25m-26qc-wcjf](https://github.com/advisories/GHSA-h25m-26qc-wcjf) | high | `>=13.0.0 <15.0.8` | `>=15.0.8` |
| `next` | [GHSA-ggv3-7p47-pfv8](https://github.com/advisories/GHSA-ggv3-7p47-pfv8) | moderate | `>=9.5.0 <15.5.13` | `>=15.5.13` |
| `next` | [GHSA-3x4c-7xq6-9pq8](https://github.com/advisories/GHSA-3x4c-7xq6-9pq8) | moderate | `>=10.0.0 <15.5.14` | `>=15.5.14` |
| `vite` | [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) | moderate | `<=6.4.1` | `>=6.4.2` |
| `next` | [GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3) | high | `>=13.0.0 <15.5.15` | `>=15.5.15` |
| `postcss` | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | moderate | `<8.5.10` | `>=8.5.10` |
| `next` | [GHSA-8h8q-6873-q5fj](https://github.com/advisories/GHSA-8h8q-6873-q5fj) | high | `>=13.0.0 <15.5.16` | `>=15.5.16` |
| `next` | [GHSA-3g8h-86w9-wvmq](https://github.com/advisories/GHSA-3g8h-86w9-wvmq) | low | `>=12.2.0 <15.5.16` | `>=15.5.16` |
| `next` | [GHSA-ffhc-5mcf-pf4q](https://github.com/advisories/GHSA-ffhc-5mcf-pf4q) | moderate | `>=13.4.0 <15.5.16` | `>=15.5.16` |
| `next` | [GHSA-vfv6-92ff-j949](https://github.com/advisories/GHSA-vfv6-92ff-j949) | low | `>=13.4.6 <15.5.16` | `>=15.5.16` |
| `next` | [GHSA-gx5p-jg67-6x7h](https://github.com/advisories/GHSA-gx5p-jg67-6x7h) | moderate | `>=13.0.0 <15.5.16` | `>=15.5.16` |
| `next` | [GHSA-h64f-5h5j-jqjh](https://github.com/advisories/GHSA-h64f-5h5j-jqjh) | moderate | `>=10.0.0 <15.5.16` | `>=15.5.16` |
| `next` | [GHSA-c4j6-fc7j-m34r](https://github.com/advisories/GHSA-c4j6-fc7j-m34r) | high | `>=13.4.13 <15.5.16` | `>=15.5.16` |
| `next` | [GHSA-wfc6-r584-vfw7](https://github.com/advisories/GHSA-wfc6-r584-vfw7) | moderate | `>=14.2.0 <15.5.16` | `>=15.5.16` |
| `next` | [GHSA-36qx-fr4f-26g5](https://github.com/advisories/GHSA-36qx-fr4f-26g5) | high | `>=12.2.0 <15.5.16` | `>=15.5.16` |
| `vite` | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | moderate | `<=6.4.2` | `>=6.4.3` |
| `vite` | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | high | `<=6.4.2` | `>=6.4.3` |
| `next` | [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) | high | `>=13.0.0 <15.5.21` | `>=15.5.21` |
| `next` | [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x) | high | `>=14.1.1 <15.5.21` | `>=15.5.21` |
| `next` | [GHSA-68g3-v927-f742](https://github.com/advisories/GHSA-68g3-v927-f742) | moderate | `>=13.0.0 <15.5.21` | `>=15.5.21` |
| `next` | [GHSA-4633-3j49-mh5q](https://github.com/advisories/GHSA-4633-3j49-mh5q) | moderate | `>=13.0.0 <15.5.21` | `>=15.5.21` |
| `next` | [GHSA-4c39-4ccg-62r3](https://github.com/advisories/GHSA-4c39-4ccg-62r3) | moderate | `>=13.0.0 <15.5.21` | `>=15.5.21` |
| `next` | [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) | high | `>=12.0.0 <15.5.21` | `>=15.5.21` |
| `next` | [GHSA-955p-x3mx-jcvp](https://github.com/advisories/GHSA-955p-x3mx-jcvp) | moderate | `>=13.0.0 <15.5.21` | `>=15.5.21` |
| `postcss` | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | high | `<=8.5.11` | `>=8.5.12` |
| `postcss` | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | moderate | `<=8.5.22` | `>=8.5.23` |
| `postcss` | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | high | `<=8.5.17` | `>=8.5.18` |
| `vitest` | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) | critical | `<3.2.6` | `>=3.2.6` |
| `next` | [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) | critical | `>=13.4.0 <15.5.24` | `>=15.5.24` |
| `vitest` | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | moderate | `>=2.1.0 <4.1.11` | `>=4.1.11` |
| `@vitest/mocker` | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | moderate | `>=2.1.0 <4.1.11` | `>=4.1.11` |
| `next` | [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) | critical | `>=10.0.0 <15.5.24` | `>=15.5.24` |

## Reproduce

Run `pnpm install --frozen-lockfile`, `pnpm audit --json` and `pnpm audit --prod --json`. Compare resolved versions and paths, not just direct declarations. After any upgrade, run all tests with TEST_DATABASE_URL, typecheck, production build and browser smoke tests. Do not enable automatic merge without the required CI check configured on the repository.
