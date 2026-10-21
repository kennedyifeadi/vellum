# Node 22 is the major the code is written for (process.getBuiltinModule needs >= 22.3).
# Pinned by digest so a rebuild gets the same Debian and Node bits.
FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS base

# Shared libraries for the Chrome that puppeteer downloads (HTML/DOCX to PDF), fonts for it
# to render text with, and tini to forward SIGTERM to Node and reap Chromium's children.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tini \
      fonts-liberation fonts-dejavu-core \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 \
      libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
      libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
      libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxkbcommon0 libxrandr2 \
      libxrender1 libxshmfence1 libxss1 libxtst6 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Inside the app directory, not the build user's home, so the runtime user can read it.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
# Postinstall scripts fetch Chrome (puppeteer, at the version package-lock.json pins) and a
# static ffmpeg (ffmpeg-static). Its release for this package version, b6.1.1, is FFmpeg
# 7.0.2 on Linux but 6.1.1 on Windows; the checksum pins the Linux binary's exact bytes.
RUN npm ci \
 && echo "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99  node_modules/ffmpeg-static/ffmpeg" \
    | sha256sum --check -

# Has the full dependency tree and sources: CI runs the test suite in this stage.
FROM deps AS build
COPY . .
RUN npm run build && rm -rf .next/cache

FROM build AS prod-deps
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/package.json /app/next.config.ts ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=deps /app/.cache/puppeteer ./.cache/puppeteer
COPY --from=build /app/public ./public
# Worker entry files are loaded from lib/ by path relative to the working directory.
COPY --from=build /app/lib ./lib
COPY --from=build --chown=node:node /app/.next ./.next
# Local-disk storage (the default driver) writes under tmp/.
RUN mkdir tmp && chown node:node tmp
USER node

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Node directly, not npm, so SIGTERM reaches next start's own graceful shutdown.
# next start listens on $PORT (3000 when unset).
CMD ["node", "node_modules/next/dist/bin/next", "start"]
