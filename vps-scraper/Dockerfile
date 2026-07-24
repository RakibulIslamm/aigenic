# syntax=docker/dockerfile:1.7

# The official Playwright image ships Chromium and every system dep it needs
# (libnss3, fonts, etc.) — saves us 200+ MB of apt. The `-noble` variant runs
# Ubuntu 24.04 + Node 22, which is required: jsdom@29 → whatwg-url@16 →
# @exodus/bytes (ESM), and only Node 22.12+ can require() an ESM module.
# Pin to the same Playwright version as the npm package for reproducibility.
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS base

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Install pnpm directly — corepack in the Playwright base image has stale
# signing keys and rejects newer pnpm releases ("Cannot find matching keyid").
# Pin to the same version used to generate pnpm-lock.yaml for reproducible builds.
RUN npm install -g pnpm@10.33.0

WORKDIR /app

# ---- deps stage: install only the package manifests so this layer caches.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# No fallback: a package.json/lockfile mismatch must fail the build here,
# not silently re-resolve dependencies at image-build time.
RUN pnpm install --prod=false --frozen-lockfile

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
