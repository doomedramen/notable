# ---- Frontend build ----
FROM node:22-alpine AS web
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Core plugins build ----
# TypeScript core plugin sources are type-checked against the plugin API
# types and bundled to the main.js each manifest.json references.
FROM node:22-alpine AS plugins
WORKDIR /app
COPY --from=web /app/node_modules ./frontend/node_modules
COPY frontend/src/plugin-api ./frontend/src/plugin-api
COPY core-plugins/ ./core-plugins/
WORKDIR /app/core-plugins
RUN npm install && npm run build && rm -rf node_modules

# ---- Backend build (frontend dist embedded into binary) ----
# rust:1 tracks the current stable — deps in the tree require edition
# 2024 support (>= 1.85), so don't pin an older minor.
FROM rust:1-alpine AS server
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY backend/ ./backend/
COPY --from=web /app/dist ./frontend/dist
WORKDIR /app/backend
RUN cargo build --release

# ---- Runtime: single static binary ----
FROM alpine:3.20
WORKDIR /data
COPY --from=server /app/backend/target/release/notable-server /usr/local/bin/
# Core plugins are immutable image assets. Community plugins are installed
# into the persistent /data volume from the configured registry.
COPY --from=plugins /app/core-plugins /usr/local/share/notable/core-plugins
# The vault (your notes, plain .md files) lives in the /data volume.
ENV VAULT_DIR=/data/vault \
    DATABASE_URL=sqlite:///data/notable.db \
    CORE_PLUGINS_DIR=/usr/local/share/notable/core-plugins \
    PLUGINS_DIR=/data/plugins \
    PLUGIN_REGISTRY_URL=https://github.com/doomedramen/notable-plugins/releases/download/plugins-latest/plugins.json \
    THEMES_DIR=/data/themes
EXPOSE 8080
VOLUME ["/data"]
CMD ["notable-server", "--headless", "--bind", "0.0.0.0:8080"]
