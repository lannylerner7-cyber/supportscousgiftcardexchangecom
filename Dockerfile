# ScousGiftCardExchange — production image for Coolify & Docker
FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* bunfig.toml ./
RUN bun install --frozen-lockfile || bun install

# Build application
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

# Copy the built output from build stage
COPY --from=build --chown=app:app /app/.output ./.output

# Create the Node HTTP runner to serve the Cloudflare fetch handler on port 3000
RUN echo 'import http from "node:http"; \
import mod from "./.output/server/index.mjs"; \
const handler = mod.default?.fetch || mod.fetch || mod.default; \
const port = parseInt(process.env.PORT || "3000", 10); \
const host = process.env.HOST || "0.0.0.0"; \
if (!handler) { \
  console.error("Failed to find fetch handler in .output/server/index.mjs"); \
  process.exit(1); \
} \
const server = http.createServer(async (req, res) => { \
  try { \
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`); \
    const headers = new Headers(); \
    for (const [k, v] of Object.entries(req.headers)) { \
      if (Array.isArray(v)) v.forEach(item => headers.append(k, item)); \
      else if (v) headers.set(k, v); \
    } \
    const body = req.method !== "GET" && req.method !== "HEAD" ? req : undefined; \
    const request = new Request(url.href, { \
      method: req.method, \
      headers, \
      body, \
      duplex: "half", \
    }); \
    const response = await handler(request, process.env, { waitUntil: () => {} }); \
    res.statusCode = response.status; \
    response.headers.forEach((val, key) => res.setHeader(key, val)); \
    if (response.body) { \
      const reader = response.body.getReader(); \
      while (true) { \
        const { done, value } = await reader.read(); \
        if (done) break; \
        res.write(value); \
      } \
    } \
    res.end(); \
  } catch (err) { \
    console.error("Request error:", err); \
    res.statusCode = 500; \
    res.end("Internal Server Error"); \
  } \
}); \
server.listen(port, host, () => { \
  console.log(`Server listening on ${host}:${port}`); \
});' > runner.mjs && chown app:app runner.mjs

USER app
EXPOSE 3000

# Healthcheck targeting the health API route
HEALTHCHECK --interval=30s --timeout=8s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/public/health" | grep -q '"ok":true' || exit 1

CMD ["node", "runner.mjs"]
