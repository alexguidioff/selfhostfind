# Multi-stage build so the runtime image (what actually runs on the NAS/homelab) stays small.
# Node 22.9+ required: the worker target's scripts use node's --env-file-if-exists flag.
FROM node:26-alpine AS base
# Prisma's query/migration engines need OpenSSL to be present on Alpine — without it they
# fail at runtime with an opaque "Could not parse schema engine response" error rather than
# a clear "openssl not found" message.
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable
WORKDIR /app
# Without this, `pnpm <cmd>` (not `pnpm install`) runs an automatic dependency-freshness
# check that tries to interactively confirm a modules-dir purge — which fails outright with
# ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY in a non-interactive Docker build.
ENV CI=true

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/public ./public
# Next's standalone output tracer already resolves and copies everything the app needs at
# runtime, including Prisma's generated query engine binary — dereferenced out of pnpm's
# .pnpm virtual store into real files. No separate node_modules/.prisma or @prisma copy is
# needed (and pnpm's symlink layout means the "obvious" path for those doesn't exist here
# anyway). Verified by inspecting this stage's output directly, not assumed.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]

# Separate target for the discovery/snapshot pipeline, and for running `prisma migrate
# deploy` (see docker-compose.yml's `migrate` service): needs full devDependencies (tsx,
# the prisma CLI) that the pruned `runner` image above deliberately doesn't ship.
FROM base AS worker
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
CMD ["pnpm", "discover"]
