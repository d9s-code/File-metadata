FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 postgresql-client \
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
