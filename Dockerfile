# MediConsult: API image + static web files. Build from the repo root.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY api/prisma api/prisma
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN cd api && npx prisma generate && npx nest build && cd ../web && npx ng build

FROM base AS api
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/api
EXPOSE 3100
CMD ["sh", "/app/deploy/api-entrypoint.sh"]

FROM busybox:stable AS web
COPY --from=build /app/web/dist/web/browser /site
CMD ["sh", "-c", "rm -rf /out/* && cp -r /site/. /out/ && echo 'mediconsult web copied'"]
