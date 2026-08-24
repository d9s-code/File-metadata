from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import auth, dashboard, dsl, emitters, ew_groups, mdfs, modes, platforms, sources, test_records, users

app = FastAPI(title="RF Recognizer Emitter Profile Manager")

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
app.include_router(sources.router)
app.include_router(modes.router)
app.include_router(dsl.router)
app.include_router(mdfs.router)
app.include_router(test_records.emitter_router)
app.include_router(test_records.mdf_router)
app.include_router(dashboard.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
