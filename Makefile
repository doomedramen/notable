.DEFAULT_GOAL := help

.PHONY: help install dev dev-backend dev-frontend test test-backend test-frontend build build-core-plugins clean

help:
	@printf '%s\n' \
		'Usage: make <target>' \
		'' \
		'  dev               Run the backend and frontend dev servers' \
		'  dev-backend       Run only the Rust backend' \
		'  dev-frontend      Run only the Vite frontend' \
		'  install           Install frontend and core-plugins dependencies' \
		'  test              Run backend and frontend tests' \
		'  build             Build the frontend, core plugins, and release server' \
		'  build-core-plugins  Type-check and bundle TypeScript core plugins' \
		'  clean             Remove generated build output'

install: frontend/node_modules/.package-lock.json core-plugins/node_modules/.package-lock.json

dev: frontend/dist/index.html frontend/node_modules/.package-lock.json build-core-plugins
	@set -eu; \
	$(MAKE) --no-print-directory dev-backend & backend_pid=$$!; \
	$(MAKE) --no-print-directory dev-frontend & frontend_pid=$$!; \
	cleanup() { \
		trap - EXIT INT TERM; \
		kill "$$backend_pid" "$$frontend_pid" 2>/dev/null || true; \
		wait "$$backend_pid" 2>/dev/null || true; \
		wait "$$frontend_pid" 2>/dev/null || true; \
	}; \
	trap 'cleanup; exit 130' INT TERM; \
	trap cleanup EXIT; \
	while kill -0 "$$backend_pid" 2>/dev/null && kill -0 "$$frontend_pid" 2>/dev/null; do \
		sleep 1; \
	done; \
	status=0; \
	if ! kill -0 "$$backend_pid" 2>/dev/null; then \
		wait "$$backend_pid" || status=$$?; \
	else \
		wait "$$frontend_pid" || status=$$?; \
	fi; \
	exit "$$status"

dev-backend: frontend/dist/index.html
	cargo run --manifest-path backend/Cargo.toml -- --headless

dev-frontend: frontend/node_modules/.package-lock.json
	npm --prefix frontend run dev

test:
	@$(MAKE) --no-print-directory -j2 test-backend test-frontend

test-backend:
	cargo test --manifest-path backend/Cargo.toml

test-frontend: frontend/node_modules/.package-lock.json
	npm --prefix frontend test

build: frontend/node_modules/.package-lock.json build-core-plugins
	npm --prefix frontend run build
	cargo build --release --manifest-path backend/Cargo.toml

build-core-plugins: core-plugins/node_modules/.package-lock.json frontend/node_modules/.package-lock.json
	npm --prefix core-plugins run build

clean:
	cargo clean --manifest-path backend/Cargo.toml
	rm -rf frontend/dist
	find core-plugins -mindepth 2 -maxdepth 2 -name main.js -delete

frontend/node_modules/.package-lock.json: frontend/package.json frontend/package-lock.json
	npm --prefix frontend ci

core-plugins/node_modules/.package-lock.json: core-plugins/package.json core-plugins/package-lock.json
	npm --prefix core-plugins ci

# rust-embed requires the frontend output directory to exist at compile time.
frontend/dist/index.html:
	mkdir -p frontend/dist
	touch frontend/dist/index.html
