# syntax=docker/dockerfile:1
FROM oven/bun:1.3.14-slim AS base
WORKDIR /app

# OCI metadata (spec §23.1). Releases must pin IMAGE_VERSION; IMAGE_SOURCE
# should point at the public repository URL once one exists (the repo has no
# git remote configured today).
ARG IMAGE_VERSION=0.10.0
ARG IMAGE_SOURCE=
LABEL org.opencontainers.image.title="consulting-api" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.source="${IMAGE_SOURCE}"

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
# All workspace manifests (apps/*, packages/*, modules/*): bun install needs
# every workspace package.json to resolve workspace:* deps (e.g. the root
# @consulting/module-notes dependency) under --frozen-lockfile. Keep this
# list in sync with the workspaces in package.json. Generator-pruned
# projects ship their own Dockerfile with only their selected features
# (generator docs / ADR-0010).
RUN mkdir -p \
  /temp/dev/apps/api \
  /temp/dev/packages/audit \
  /temp/dev/packages/auth \
  /temp/dev/packages/auth-client \
  /temp/dev/packages/authorization \
  /temp/dev/packages/config \
  /temp/dev/packages/contracts \
  /temp/dev/packages/core \
  /temp/dev/packages/sdk \
  /temp/dev/modules/example \
  /temp/dev/modules/files \
  /temp/dev/modules/jobs \
  /temp/dev/modules/notes \
  /temp/dev/modules/notifications \
  /temp/dev/modules/organizations
COPY apps/api/package.json /temp/dev/apps/api/
COPY packages/audit/package.json /temp/dev/packages/audit/
COPY packages/auth/package.json /temp/dev/packages/auth/
COPY packages/auth-client/package.json /temp/dev/packages/auth-client/
COPY packages/authorization/package.json /temp/dev/packages/authorization/
COPY packages/config/package.json /temp/dev/packages/config/
COPY packages/contracts/package.json /temp/dev/packages/contracts/
COPY packages/core/package.json /temp/dev/packages/core/
COPY packages/sdk/package.json /temp/dev/packages/sdk/
COPY modules/example/package.json /temp/dev/modules/example/
COPY modules/files/package.json /temp/dev/modules/files/
COPY modules/jobs/package.json /temp/dev/modules/jobs/
COPY modules/notes/package.json /temp/dev/modules/notes/
COPY modules/notifications/package.json /temp/dev/modules/notifications/
COPY modules/organizations/package.json /temp/dev/modules/organizations/
RUN cd /temp/dev && bun install --frozen-lockfile

FROM base AS prod
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN mkdir -p \
  /temp/prod/apps/api \
  /temp/prod/packages/audit \
  /temp/prod/packages/auth \
  /temp/prod/packages/auth-client \
  /temp/prod/packages/authorization \
  /temp/prod/packages/config \
  /temp/prod/packages/contracts \
  /temp/prod/packages/core \
  /temp/prod/packages/sdk \
  /temp/prod/modules/example \
  /temp/prod/modules/files \
  /temp/prod/modules/jobs \
  /temp/prod/modules/notes \
  /temp/prod/modules/notifications \
  /temp/prod/modules/organizations
COPY apps/api/package.json /temp/prod/apps/api/
COPY packages/audit/package.json /temp/prod/packages/audit/
COPY packages/auth/package.json /temp/prod/packages/auth/
COPY packages/auth-client/package.json /temp/prod/packages/auth-client/
COPY packages/authorization/package.json /temp/prod/packages/authorization/
COPY packages/config/package.json /temp/prod/packages/config/
COPY packages/contracts/package.json /temp/prod/packages/contracts/
COPY packages/core/package.json /temp/prod/packages/core/
COPY packages/sdk/package.json /temp/prod/packages/sdk/
COPY modules/example/package.json /temp/prod/modules/example/
COPY modules/files/package.json /temp/prod/modules/files/
COPY modules/jobs/package.json /temp/prod/modules/jobs/
COPY modules/notes/package.json /temp/prod/modules/notes/
COPY modules/notifications/package.json /temp/prod/modules/notifications/
COPY modules/organizations/package.json /temp/prod/modules/organizations/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

FROM base AS release
ARG IMAGE_VERSION=0.10.0
ENV NODE_ENV=production
ENV APP_VERSION="${IMAGE_VERSION}"
# Shutdown signal (spec §23.1/§23.5): the server drains in-flight requests on
# SIGTERM; init systems (compose `init: true`, tini) deliver it to PID 1.
STOPSIGNAL SIGTERM
COPY --from=prod /temp/prod/node_modules node_modules
COPY --from=prerelease /app/package.json ./
COPY --from=prerelease /app/apps ./apps
COPY --from=prerelease /app/packages ./packages
COPY --from=prerelease /app/modules ./modules
# Standalone outbox worker entrypoint (compose profile `worker`). Backups,
# migrations and seed run as ops jobs OUTSIDE the image — never in release
# (docs/backup-restore.md, docs/migrations-runbook.md; spec §23.4).
RUN mkdir -p /app/scripts
COPY --from=prerelease /app/scripts/worker.ts /app/scripts/worker.ts
USER bun
EXPOSE 3000
HEALTHCHECK CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["bun", "run", "apps/api/src/server.ts"]
