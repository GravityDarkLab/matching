# Build context: ./api
# docker build -f api/Dockerfile ./api

# ─── Stage 1: install production dependencies ────────────────────────────────
FROM oven/bun:1.4.0-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen --production

# ─── Stage 2: lean production image ──────────────────────────────────────────
FROM oven/bun:1.4.0-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules

# Copy API source and docs (openapi.yaml is served in non-production).
COPY src           ./src
COPY docs          ./docs
COPY package.json  tsconfig.json ./

EXPOSE 3001

# Bun runs TypeScript directly — no compile step needed.
CMD ["bun", "run", "src/server.ts"]
