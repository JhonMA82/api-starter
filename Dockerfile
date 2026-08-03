# syntax=docker/dockerfile:1
FROM oven/bun:1.3.14-slim AS base
WORKDIR /app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
COPY apps/api/package.json /temp/dev/apps/api/
COPY packages/config/package.json /temp/dev/packages/config/
COPY packages/core/package.json /temp/dev/packages/core/
COPY packages/contracts/package.json /temp/dev/packages/contracts/
COPY modules/example/package.json /temp/dev/modules/example/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
COPY apps/api/package.json /temp/prod/apps/api/
COPY packages/config/package.json /temp/prod/packages/config/
COPY packages/core/package.json /temp/prod/packages/core/
COPY packages/contracts/package.json /temp/prod/packages/contracts/
COPY modules/example/package.json /temp/prod/modules/example/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

FROM base AS release
ENV NODE_ENV=production
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /app/package.json ./
COPY --from=prerelease /app/apps ./apps
COPY --from=prerelease /app/packages ./packages
COPY --from=prerelease /app/modules ./modules
USER bun
EXPOSE 3000
HEALTHCHECK CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["bun", "run", "apps/api/src/server.ts"]
