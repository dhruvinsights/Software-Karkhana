# One image, three roles: the API service, the coding worker Job and the
# migrate Job. Cloud Run picks the role with --command.

# --- Stage 1: build the React app ---------------------------------------
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- Stage 1b: AX manifest validator (uses google/ax's own validators) -----
FROM golang:1.27 AS axtools
WORKDIR /src
COPY third_party/ax ./third_party/ax
COPY tools/axcheck ./tools/axcheck
WORKDIR /src/tools/axcheck
RUN CGO_ENABLED=0 go build -o /out/axcheck .

# --- Stage 1c: OSV-Scanner (google/osv-scanner), pinned ----------------------
# Scans dependency manifests for known vulnerabilities (Security station).
FROM golang:1.27 AS osvtools
RUN CGO_ENABLED=0 GOBIN=/out go install github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.7.0

# --- Stage 2: Python runtime -------------------------------------------
FROM python:3.12-slim
# git: the worker clones and pushes. No compilers, no shells beyond the base.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.8.13
# repomix packs a repository for the AI (scans, PRDs, chat, QA agent). It runs
# from a pinned global install, never fetched at request time.
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && npm install -g --no-audit --no-fund repomix@1.18.1 \
    && npm cache clean --force
ENV REPOMIX_CMD=/usr/local/bin/repomix

WORKDIR /code
# Precompile bytecode at build time: the code is read-only at runtime, and
# compiled modules shave cold-start time.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
# Dependencies first (cached layer), then the project. --frozen: the image is
# built from exactly uv.lock, never re-resolved.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --no-dev --no-install-project --frozen
COPY app ./app
COPY db ./db
COPY --from=axtools /out/axcheck /usr/local/bin/axcheck
COPY --from=osvtools /out/osv-scanner /usr/local/bin/osv-scanner
COPY --from=web /web/dist ./web/dist
RUN uv sync --no-dev --frozen
# Headless Chromium for the PDF reports (idea evaluations, PRDs).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN /code/.venv/bin/playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

# Run as an unprivileged user. /code stays root-owned, so the process cannot
# modify its own code; all runtime writes go to temp directories.
RUN useradd --create-home --uid 10001 karkhana
USER karkhana
ENV OSV_SCANNER_BIN=/usr/local/bin/osv-scanner AXCHECK_BIN=/usr/local/bin/axcheck PATH="/code/.venv/bin:$PATH" PYTHONUNBUFFERED=1 STATIC_DIR=/code/web/dist

ARG COMMIT_SHA=""
ENV COMMIT_SHA=${COMMIT_SHA}
EXPOSE 8080
# exec form + $PORT from Cloud Run (defaults to 8080).
CMD ["sh", "-c", "exec uvicorn app.fast_api_app:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
