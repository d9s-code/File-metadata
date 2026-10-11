from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.services.search_service import search

router = APIRouter(prefix="/search", tags=["search"])


class SearchHit(BaseModel):
    kind: str
    id: str
    title: str
    subtitle: str | None = None
    # Where the hit opens in the app.
    url: str


@router.get("", response_model=list[SearchHit])
def search_everything(
    q: str = Query("", max_length=200), db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[dict]:
    """Emitters, Modes, Sources, Platforms, MDFs and Intercepts whose name has every word typed."""
    return search(db, q)
