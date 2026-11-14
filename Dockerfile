# KomaYomi container image — build the frontend and the bundled server, then run a
# small runtime image. Raw manga, annotations and exports are mounted, never baked in.

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies from the lockfile only, so code edits do not bust this layer.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY shared ./shared
COPY server ./server
COPY src ./src
COPY electron ./electron
COPY scripts ./scripts

RUN npm run build && npm run server:build

# ---------- runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3921 \
    RAW_DIR=/data/raw \
    DATA_DIR=/data/annotations \
    EXPORT_DIR=/data/exports \
    STATIC_DIR=/app/dist \
    LOG_LEVEL=info

# Run as an unprivileged user; the mounted folders must be writable by uid 10001.
RUN addgroup -g 10001 -S komayomi \
 && adduser -u 10001 -S komayomi -G komayomi \
 && mkdir -p /data/raw /data/annotations /data/exports /app/dist /app/dist-server \
 && chown -R komayomi:komayomi /data /app

# Only the bundled outputs are needed — dist-server/*.mjs already inlines pngjs/jpeg-js,
# so we deliberately skip node_modules in the final image.
COPY --from=build --chown=komayomi:komayomi /app/dist ./dist
COPY --from=build --chown=komayomi:komayomi /app/dist-server ./dist-server
COPY --from=build --chown=komayomi:komayomi /app/package.json ./package.json

USER komayomi

EXPOSE 3921

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3921)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/standalone.mjs"]
