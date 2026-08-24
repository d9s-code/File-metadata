from pydantic import BaseModel


class DashboardOut(BaseModel):
    emitter_status_counts: dict[str, int]
    mdf_status_counts: dict[str, int]
    needs_attention: list[str]
