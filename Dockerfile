# ScousGiftCardExchange — production image
# Build:  docker compose build
# Run:    docker compose up -d
#
# Nothing secret is baked into the image. Every value the site needs — the
# Cloudflare database and file-storage details, the mail server and the session
# key — is read from the environment when the container starts.

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock* bunfig.toml ./
RUN bun install --frozen-lockfile || bun install

COPY . .
ENV NODE_ENV=production
RUN bun run build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

RUN apk add --no-cache wget && addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/.output ./.output

USER app
EXPOSE 3000

# The health check asks the app whether the database actually answers, so a
# container that is running but cannot reach the database is reported unhealthy.
HEALTHCHECK --interval=30s --timeout=8s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/public/health" | grep -q '"ok":true' || exit 1

CMD ["node", ".output/server/index.mjs"]
