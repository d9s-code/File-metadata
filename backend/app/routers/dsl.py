from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.enums import PriType, Role
from app.deps import require_role
from app.dsl.exceptions import DslSyntaxError
from app.dsl.parser import parse_mode_line
from app.dsl.renderer import render_mode_line

router = APIRouter(prefix="/dsl", tags=["dsl"])


class DslParseRequest(BaseModel):
    text: str


class DslParseResponse(BaseModel):
    rf_min_mhz: float
    rf_max_mhz: float
    pw_min_us: float
    pw_max_us: float
    pri_type: PriType
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    jitter_min_us: float | None = None
    jitter_max_us: float | None = None
    pri_stagger_values_us: list[float] = []


class DslRenderRequest(BaseModel):
    pri_type: PriType
    rf_min_mhz: float
    rf_max_mhz: float
    pw_min_us: float
    pw_max_us: float
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    jitter_min_us: float | None = None
    jitter_max_us: float | None = None
    pri_stagger_values_us: list[float] | None = None


class DslRenderResponse(BaseModel):
    text: str


@router.post("/parse", response_model=DslParseResponse)
def dsl_parse(payload: DslParseRequest, _=Depends(require_role(Role.viewer))) -> DslParseResponse:
    try:
        parsed = parse_mode_line(payload.text)
        return DslParseResponse(**vars(parsed))
    except DslSyntaxError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.post("/render", response_model=DslRenderResponse)
def dsl_render(payload: DslRenderRequest, _=Depends(require_role(Role.viewer))) -> DslRenderResponse:
    try:
        text = render_mode_line(**payload.model_dump())
        return DslRenderResponse(text=text)
    except DslSyntaxError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
