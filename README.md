# SelfHostFind

An automatic discovery engine and catalog for open-source, self-hostable applications —
the kind of thing you'd run on a NAS or in a homelab. It finds candidates on GitHub with
targeted queries (not a full crawl), filters out forks/libraries/dead projects, extracts
Docker/Compose/README signals, classifies each project by keyword rules, scores it on
activity/docs/install-ease/NAS-friendliness (not just star count), and serves it all through
a searchable, filterable catalog.

## Why

Directories like Awesome-Selfhosted or selfh.st are manually curated and miss a lot of real
projects — especially ones that don't tag themselves with the `self-hosted` GitHub topic.
This project is an automated funnel: broad-but-targeted GitHub search → cheap rule-based
prefilter → deep per-repo analysis → classification → scoring → catalog.

## Architecture

```
selfhosted-discovery/
├── prisma/
│   ├── schema.prisma        # Repository / Application / MetricSnapshot / Scan models
│   └── seed.ts               # Demo data (incl. a Balancia-style example)
├── src/
│   ├── app/                  # Next.js App Router: pages + API routes
│   │   ├── page.tsx           # Homepage: trending / new / promising / updated sections + filters
│   │   ├── apps/[slug]/        # Application detail page
│   │   ├── admin/               # Admin panel (approve / hide / correct)
│   │   └── api/
│   │       ├── admin/apps/[id]/  # PATCH: moderate/correct an application
│   │       ├── admin/login|logout/
│   │       └── cron/discover/     # Optional HTTP-triggered pipeline run
│   ├── components/            # AppCard, FilterBar, SearchBar, Badge
│   ├── lib/
│   │   ├── github.ts           # GitHub REST client: rate-limit + backoff aware
│   │   ├── classification.ts   # Keyword-rule classifier (category, alternatives-to, confidence)
│   │   ├── scoring.ts           # Weighted health score + popularity/growth
│   │   ├── verification.ts       # Unverified → Auto-verified promotion/demotion rules
│   │   ├── alerts.ts              # Webhook alerts + dead-man's-switch heartbeat
│   │   ├── query.ts                # Catalog filter/sort → Prisma where/orderBy
│   │   ├── auth.ts                  # Simple signed-cookie admin session
│   │   └── db.ts                     # Prisma client singleton
│   ├── pipeline/               # The discovery pipeline itself
│   │   ├── queries.ts            # Seed GitHub search queries (topics, phrases, filenames)
│   │   ├── prefilter.ts           # Cheap exclusion rules (forks, archived, libraries, ...)
│   │   ├── analyze.ts              # Per-repo deep analysis (Dockerfile, README, ports, DBs, ...)
│   │   ├── discover.ts              # Orchestrates the full funnel, idempotent upsert
│   │   ├── reconcile.ts              # Catches renames/archival/deletion discovery can't see
│   │   ├── snapshot.ts                # Daily metric snapshot for trending calculations
│   │   └── concurrency.ts              # Shared bounded-parallelism helper
│   └── tests/                  # Vitest unit tests for the pipeline's core logic
├── scripts/backup.sh          # DB dump + restore-verification + retention
├── docker-compose.yml         # postgres + web + (jobs profile) discover/snapshot/backup workers
├── Dockerfile                  # runner (web) + worker (pipeline) targets
└── .github/
    ├── dependabot.yml           # Weekly dependency update PRs
    └── workflows/
        ├── ci.yml                 # typecheck + test + build, required for merge
        ├── dependabot-auto-merge.yml  # Patch/minor bumps merge themselves once CI passes
        └── daily-discovery.yml     # Alternative to running cron in your own infra
```

## How the pipeline decides what gets in

1. **Discovery** (`pipeline/queries.ts` + `lib/github.ts`): a fixed list of targeted GitHub
   searches — topics (`self-hosted`, `homelab`, `nas`, ...), description/README phrases
   (`"self-hosted"`, `"alternative to"`, `"personal server"`), and filename searches
   (`docker-compose.yml`, `Dockerfile`) — each capped at a few pages. This is a funnel, not
   a crawl: GitHub's search API caps at 1000 results/query anyway.
2. **Prefilter** (`pipeline/prefilter.ts`): cheap, explainable rules reject forks, archived
   repos, missing licenses, no-push-in-2-years repos, and description patterns that scream
   "SDK", "awesome list", "template", or "plugin for X" — before we spend API calls on deep
   analysis.
3. **Analyze** (`pipeline/analyze.ts`): fetches root file listing (Dockerfile/compose
   detection), README (screenshots, DB mentions, ports, env vars, docs/demo links),
   languages, and latest release.
4. **Classify** (`lib/classification.ts`): keyword-rule engine that outputs the same
   structured shape an LLM-based classifier could later produce —
   `{ isSelfHostedApp, category, alternativesTo, nasFriendly, confidence }` — so swapping in
   an LLM later doesn't require touching the DB schema or the pipeline's call sites.
5. **Score** (`lib/scoring.ts`): a weighted 0–100 health score — activity 25%, releases 20%,
   Docker 15%, docs 15%, community 10%, license 5%, NAS-compat 10% — deliberately *not*
   dominated by raw star count. Popularity and growth are tracked as separate scores instead
   of being folded into "health", so a small, fresh, Compose-ready project can outrank a
   huge but abandoned one on the default sort.
6. **Persist**: idempotent upsert keyed on GitHub's numeric repo ID. Every run is logged as a
   `Scan` row (included/excluded + reason) for auditability. Fields an admin has manually
   corrected are tracked in `Application.manualOverrides` and are never overwritten by
   subsequent automatic runs.

Discovery only ever *finds* new candidates — it never re-checks repos already in the catalog
unless they happen to resurface in a future search. A repo that gets deleted or renamed would
otherwise sit in the catalog forever pointing at a dead link. See "Keeping the catalog honest"
below for how `reconcile.ts` closes that gap.

## Local development

Requires Node 22.9+ (for `--env-file-if-exists`, used by the seed/discover/snapshot
scripts), pnpm, and a local or remote PostgreSQL instance.

```bash
cp .env.example .env
# edit .env: set DATABASE_URL, GITHUB_TOKEN, ADMIN_PASSWORD, ADMIN_SESSION_SECRET

pnpm install
pnpm prisma:migrate:dev   # creates the schema
pnpm seed                  # optional: loads demo data, including a Balancia-style example
pnpm dev                    # http://localhost:3000
```

To run the real discovery pipeline against GitHub (needs `GITHUB_TOKEN` — unauthenticated
requests are limited to 60/hour, which isn't enough):

```bash
pnpm discover    # runs the full funnel, upserts Repository + Application rows
pnpm reconcile    # checks existing repos for renames/archival/deletion (see below)
pnpm snapshot      # records MetricSnapshot rows; run this daily too, for trending
```

Run tests:

```bash
pnpm test
pnpm typecheck
```

## Deploying (e.g. on a NAS / small Linux box)

```bash
cp .env.example .env   # fill in real secrets
docker compose up -d --build              # postgres + web
docker compose run --rm discover           # first import
docker compose run --rm reconcile           # first liveness/rename/archival check
docker compose run --rm snapshot             # first metric snapshot
docker compose run --rm backup                # first backup (see "Backups" below)
```

Then schedule the daily jobs. `reconcile` should run after `discover` and before `snapshot`,
so verification-status re-evaluation sees freshly-updated `archived`/`pushedAt` data rather
than whatever was last known. Two options:

- **Host crontab** (simplest if the box runs 24/7):
  ```cron
  0  3 * * * cd /path/to/selfhosted-discovery && docker compose run --rm discover
  10 3 * * * cd /path/to/selfhosted-discovery && docker compose run --rm reconcile
  20 3 * * * cd /path/to/selfhosted-discovery && docker compose run --rm snapshot
  30 2 * * * cd /path/to/selfhosted-discovery && docker compose run --rm backup
  ```
- **GitHub Actions** (`.github/workflows/daily-discovery.yml`): set `DATABASE_URL` and
  `GH_DISCOVERY_TOKEN` as repo secrets; this only requires your Postgres instance to be
  reachable from GitHub's runners (e.g. a managed Postgres with a public endpoint), which
  makes sense if you don't want the pipeline depending on the NAS being online.

The `web` service also exposes `POST /api/cron/discover` (bearer-token protected via
`CRON_SECRET`) as a third option for external schedulers that can only make HTTP calls.

## Admin panel

Visit `/admin`, sign in with `ADMIN_PASSWORD`. From there you can change an app's category,
approve it (flips `verificationStatus` to `MANUALLY_VERIFIED`), or hide it. Any field you
edit through the admin API is recorded in `Application.manualOverrides` and is excluded from
future automatic overwrites by the discovery pipeline.

## Alerting

Nobody is tailing logs on an unattended catalog, so a failure needs a channel to get out.
Two independent, optional mechanisms (`lib/alerts.ts`):

- **`ALERT_WEBHOOK_URL`** (+ `ALERT_WEBHOOK_FORMAT`: `ntfy` | `slack` | `discord` | `generic`)
  — pushes a notification when: the discovery or snapshot job crashes fatally (e.g. an
  invalid/expired `GITHUB_TOKEN` — every search query returning 401 is detected explicitly,
  rather than being silently treated as "nothing new today"); some but not all search
  queries fail; or the per-repo failure rate in a run is abnormally high (≥30% and ≥5
  repos), which usually means something systemic broke rather than a handful of bad repos.
- **`HEARTBEAT_URL`** — pinged on every *successful* `discover`/`snapshot` run. Point it at a
  healthchecks.io check, an Uptime Kuma push monitor, or Cronitor, with a grace period a bit
  longer than your schedule. This catches what a webhook alert structurally cannot: the host
  or container stopping entirely, so nothing ever runs to report an error in the first place.
  `BACKUP_HEARTBEAT_URL` does the same for the backup job, kept separate so a stalled backup
  doesn't hide behind a healthy discovery pipeline.

Alerting failures never crash the job they're reporting on — delivery is always best-effort.

## Backups

`docker compose run --rm backup` (or scheduled the same way as `discover`/`snapshot`, see
below) dumps the database with `pg_dump`, and — because a backup nobody has restored is
unverified insurance — immediately restores that dump into a throwaway database on the same
Postgres server and runs a sanity query against it before calling the backup good. Failure at
any step (dump, empty file, corrupt gzip, failed restore) fires an `ALERT_WEBHOOK_URL` alert
and the job exits non-zero. Old backups beyond `BACKUP_RETENTION_DAYS` (default 14) are
pruned automatically.

Backups are written to the `db-backups` Docker volume, i.e. still on the same disk as the
database. **Copying them off-box is on you** — this project doesn't assume any particular
remote storage. One way, added to the host crontab after the backup job:

```cron
30 2 * * * cd /path/to/selfhosted-discovery && docker compose run --rm backup
0  3 * * * docker run --rm -v selfhosted-discovery_db-backups:/backups -v /path/to/offbox:/offbox alpine \
  sh -c "cp /backups/*.sql.gz /offbox/ 2>/dev/null" # or rclone/rsync to actual off-box storage
```

To restore manually from a specific dump:

```bash
gunzip -c selfhostfind-<timestamp>.sql.gz | docker compose exec -T db \
  psql -U ${POSTGRES_USER:-selfhostfind} -d ${POSTGRES_DB:-selfhostfind}
```

## Keeping dependencies current

An unattended app that never updates its dependencies accumulates CVEs silently — this
happened *during this project's own setup*: Prisma reported a major version behind the day
the lockfile was first generated. `.github/dependabot.yml` opens weekly PRs for npm, Docker
base images, and GitHub Actions versions. `.github/workflows/dependabot-auto-merge.yml`
merges patch/minor bumps on its own once `.github/workflows/ci.yml` (typecheck + tests +
build against a real Postgres) passes; a major version bump is left open with a comment,
since auto-merging major bumps blindly just trades slow security rot for fast breakage.

This needs a one-time setup that can't be done from files alone (it's a GitHub repo setting,
not something in this repository):

1. Push this repo to GitHub.
2. Repo Settings → General → Pull Requests → enable **Allow auto-merge**.
3. Repo Settings → Branches → add a protection rule on `main` requiring the **`ci-passed`**
   status check (from `ci.yml`) before merging.

Without step 3, `gh pr merge --auto` still queues the merge but nothing actually blocks it on
CI — the check has to be *required* for auto-merge to mean anything.

## Keeping the catalog honest

Discovery only ever *finds* candidates — it never revisits a repo already in the catalog
unless it happens to resurface in a future search. That's a real problem on its own: a repo
that gets deleted stops appearing in any search result (its URL just 404s), and one that gets
renamed or transferred does too, under its *old* name — so without a separate check, both
just sit in the catalog forever, one pointing at a dead link and the other slowly drifting out
of date.

`pipeline/reconcile.ts` closes this by looking every catalog repo up by its immutable numeric
GitHub ID (`GET /repositories/{id}`) rather than by owner/name — an ID lookup transparently
follows renames and ownership transfers, so GitHub hands back the *current* `full_name`
itself. Each run:

- **Deleted or inaccessible** (404/410): `Repository.unreachable` is set `true`. The row and
  its history are kept for audit — `reconcile` never deletes data — but the app disappears
  from the public catalog (`lib/query.ts` always filters `unreachable: false`), and it can
  never hold `Auto-verified` status (see `lib/verification.ts`).
- **Renamed or transferred**: `owner`, `name`, `fullName`, and `repositoryUrl` are updated to
  the new values. The catalog's own `Application.slug` (and thus this site's permalink) never
  changes, even though the upstream URL moved.
- **Archived upstream**: `Repository.archived` is refreshed even though the repo dropped out
  of search results (which filter `archived:false`) — otherwise this would only be caught if
  the repo happened to resurface in a future search, which an archived repo never will.
- Stars/forks/watchers/open issues/`pushedAt` are refreshed from the same API response while
  we're already there, so a repo that's gone quiet doesn't keep looking falsely "active" in
  scoring/verification just because it stopped resurfacing in search.

Also prunes `Scan` audit rows older than `SCAN_RETENTION_DAYS` (default 90) each run, so that
table — one row per candidate per discovery run, forever otherwise — doesn't grow unbounded.

Like `discover`/`snapshot`, `reconcile` alerts on a fatal failure (e.g. every lookup failing,
which usually means an invalid/expired token) and on an abnormally high per-repo failure rate,
and pings `HEARTBEAT_URL` on success.

## What's intentionally deferred to phase 2

Per the project brief, the MVP ships keyword-based classification, Docker/Compose detection,
categories/filters, a simple health score, the daily job, and the admin panel — all working
end-to-end. Deferred:

- LLM-based classification (the `classify()` output shape is already LLM-ready — see
  `lib/classification.ts`; a future version can call a model and return the same JSON shape,
  with `Application.classificationSource` flipping to `"llm"`).
- Full multi-arch image inspection (current ARM64/AMD64 detection is README-text-based, not
  a registry manifest lookup).
- Resource-usage estimates.
- Additional sources beyond GitHub (Codeberg, GitLab, Docker registries) — `Repository.source`
  already exists as a field for this.

## Data honesty

Every automatically-discovered application starts as `Unverified`. Classification results
carry a `classificationConfidence` (0–1) and `classificationSource`. The catalog UI surfaces
an explicit warning on unverified listings rather than presenting inferred data as fact.

`Unverified` apps are promoted to `Auto-verified` (`lib/verification.ts`) once there's
concrete evidence, not just a confident guess: a classification confidence above
`AUTO_VERIFY_CONFIDENCE_THRESHOLD` (default 0.75) *and* a real license, a detected
Dockerfile/Compose file, a non-trivial README, a resolved category, a repo that isn't
archived or unreachable, and a push within the last 12 months. This is re-evaluated on every
`discover` and `snapshot` run, in both directions — a project that later goes archived, drops
Docker support, or goes stale loses its auto-verified badge automatically. `Manually_verified`
(set from `/admin`) is the one status the pipeline never touches, in either direction.

A repo the `reconcile` job finds deleted or transferred out of reach is never presented as
fact either: it's dropped from the public catalog rather than left showing stale data (see
"Keeping the catalog honest" above).
