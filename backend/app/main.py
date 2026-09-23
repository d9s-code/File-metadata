from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import insecure_setting_problems, settings
from app.routers import (
    ambiguity,
    audit_log,
    auth,
    customers,
    dashboard,
    dsl,
    emitters,
    ew_groups,
    function_groups,
    imports,
    intercepts,
    mdfs,
    modes,
    platforms,
    source_groups,
    sources,
    test_lines,
    test_records,
    trash,
    users,
)

if not settings.is_dev and (problems := insecure_setting_problems(settings)):
    raise RuntimeError(
        "Refusing to start: " + "; ".join(problems)
        + ". Generate a secret with `openssl rand -hex 32`, or set APP_ENV=dev for local development."
    )

app = FastAPI(
    title="RF Recognizer Emitter Profile Manager",
    docs_url="/docs" if settings.is_dev else None,
    redoc_url="/redoc" if settings.is_dev else None,
    openapi_url="/openapi.json" if settings.is_dev else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(platforms.router)
app.include_router(emitters.router)
app.include_router(ew_groups.router)
app.include_router(function_groups.router)
app.include_router(sources.router)
app.include_router(source_groups.router)
app.include_router(customers.router)
app.include_router(imports.router)
app.include_router(intercepts.router)
app.include_router(modes.router)
app.include_router(dsl.router)
app.include_router(mdfs.router)
app.include_router(test_records.emitter_router)
app.include_router(test_records.mdf_router)
app.include_router(test_lines.router)
app.include_router(dashboard.router)
app.include_router(ambiguity.router)
app.include_router(audit_log.router)
app.include_router(trash.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
