# Build context: ./frontend
# docker build -f frontend/Dockerfile ./frontend

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM oven/bun:1.4.2-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen

COPY . .

# Vite bakes env vars at build time — pass them as build args.
ARG VITE_API_URL=
ARG VITE_INVITE_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_INVITE_KEY=$VITE_INVITE_KEY

RUN bun run build

# ─── Stage 2: serve with nginx ────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/dist  /usr/share/nginx/html
COPY                nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
