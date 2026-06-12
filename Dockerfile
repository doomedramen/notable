# ---- Frontend build ----
FROM node:22-alpine AS web
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Backend build (frontend dist embedded into binary) ----
FROM rust:1.83-alpine AS server
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
# Example plugin ships with the image; the /data volume (mountable) is
# where user plugins/themes live: /data/plugins, /data/themes.
COPY plugins /data/plugins
# The vault (your notes, plain .md files) lives in the /data volume.
ENV VAULT_DIR=/data/vault \
    DATABASE_URL=sqlite:///data/notable.db \
    PLUGINS_DIR=/data/plugins \
    THEMES_DIR=/data/themes
EXPOSE 8080
VOLUME ["/data"]
CMD ["notable-server", "--headless", "--bind", "0.0.0.0:8080"]
