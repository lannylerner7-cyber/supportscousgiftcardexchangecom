FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock* bunfig.toml ./
RUN bun install --frozen-lockfile || bun install

COPY . .

ENV NODE_ENV=production
ENV NITRO_PRESET=node_server
RUN bun run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

RUN groupadd --system app && useradd --system --gid app app

COPY --from=build --chown=app:app /app/.output ./.output

USER app
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
