# ScousGiftCardExchange — production image for Coolify & Docker
# Build:  docker compose build
# Run:    docker compose up -d

FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* bunfig.toml ./
RUN bun install --frozen-lockfile || bun install

# Copy source and build
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

# Copy production build outputs
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json

USER app
EXPOSE 3000

# Container healthcheck querying the public health endpoint
HEALTHCHECK --interval=30s --timeout=8s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/public/health" | grep -q '"ok":true' || exit 1

CMD ["node", "dist/server/index.mjs"]
