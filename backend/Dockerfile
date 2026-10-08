FROM python:3.11-slim

# The Postgres client tools (pg_dump/pg_restore, for backups) must be at least
# the server's major version — pg_dump refuses to dump a newer server — and are
# best exactly the server's (`SELECT version();`), e.g.
#   docker build --build-arg PG_CLIENT_MAJOR=16 ./backend
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

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir -p /backups && chown app /backups
USER app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
