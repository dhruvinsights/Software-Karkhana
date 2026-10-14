# One image, three roles: the API service, the coding worker Job and the
# migrate Job. Cloud Run picks the role with --command.

# --- Stage 1: build the React app ---------------------------------------
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- Stage 2: Python runtime -------------------------------------------
FROM python:3.12-slim
# git: the worker clones and pushes. No compilers, no shells beyond the base.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.8.13

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
COPY --from=web /web/dist ./web/dist
RUN uv sync --no-dev --frozen

# Run as an unprivileged user. /code stays root-owned, so the process cannot
# modify its own code; all runtime writes go to temp directories.
RUN useradd --create-home --uid 10001 karkhana
USER karkhana
ENV PATH="/code/.venv/bin:$PATH" PYTHONUNBUFFERED=1 STATIC_DIR=/code/web/dist

ARG COMMIT_SHA=""
ENV COMMIT_SHA=${COMMIT_SHA}
EXPOSE 8080
# exec form + $PORT from Cloud Run (defaults to 8080).
CMD ["sh", "-c", "exec uvicorn app.fast_api_app:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
