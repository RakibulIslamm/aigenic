# syntax=docker/dockerfile:1.7

# The official Playwright image already ships Node 20+, Chromium, and every
# system dep Chromium needs (libnss3, fonts, etc.) — saves us 200+ MB of apt.
FROM mcr.microsoft.com/playwright:latest AS base

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH

# Enable pnpm via corepack so the lockfile stays the source of truth.
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# ---- deps stage: install only the package manifests so this layer caches.
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod=false --frozen-lockfile || pnpm install --prod=false

# ---- build stage: compile TypeScript.
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# ---- runtime: drop devDependencies, keep only what the JS needs.
FROM base AS runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Strip dev dependencies for a leaner final image.
RUN pnpm prune --prod

ENV PORT=3007 \
    LOG_LEVEL=info
EXPOSE 3007

# Playwright base image runs as non-root user "pwuser" — keep it.
USER pwuser

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3007/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
