# The whole app in one image: the frontend is built here and served by the
# backend, next to the API under /api — one container behind Traefik, no
# separate web server. The backup service runs this same image.

# --- The frontend, built once -------------------------------------------
FROM node:22-alpine AS frontend

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# Same origin as the pages, so the browser needs no address baked in — the
# hostname can change without rebuilding.
ENV VITE_API_BASE_URL=/api
RUN npm run build

# --- The backend, serving the API and the built frontend -----------------
FROM python:3.11-slim

# The Postgres client tools (pg_dump/pg_restore, for backups) must be at least
# the server's major version — pg_dump refuses to dump a newer server — and are
# best exactly the server's (`SELECT version();`), e.g.
#   docker build --build-arg PG_CLIENT_MAJOR=16 .
# The default, 15, matches the server this app runs against (Postgres 15.17).
# Debian's own postgresql-client lags behind, so take it from the PostgreSQL
# project's apt repository.
ARG PG_CLIENT_MAJOR=15
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends libpq5 postgresql-client-${PG_CLIENT_MAJOR} \
    && apt-get purge -y curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend /frontend/dist /app/static

RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir -p /backups && chown app /backups
USER app

EXPOSE 8000

# app.site: the API under /api and the frontend everywhere else.
CMD ["uvicorn", "app.site:site", "--host", "0.0.0.0", "--port", "8000"]
