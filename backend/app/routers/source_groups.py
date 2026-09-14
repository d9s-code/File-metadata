from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.source_group import SourceGroup
from app.schemas.source_group import SourceGroupCreate, SourceGroupOut, SourceGroupUpdate
from app.deps import require_role

router = APIRouter(
    prefix="/source-groups",
    tags=["source_groups"],
)

@router.get("/", response_model=List[SourceGroupOut])
def list_source_groups(db: Session = Depends(get_db)):
    """Lists all source groups."""
    return db.query(SourceGroup).all()

@router.post("/", response_model=SourceGroupOut, status_code=status.HTTP_201_CREATED)
def create_source_group(
    source_group: SourceGroupCreate, 
    db: Session = Depends(get_db),
    _ = require_role("admin")
):
    """Creates a new source group."""
    db_group = SourceGroup(**source_group.model_dump())
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

@router.get("/{group_id}", response_model=SourceGroupOut)
def get_source_group(group_id: UUID, db: Session = Depends(get_db)):
    """Gets a specific source group by ID."""
    group = db.query(SourceGroup).filter(SourceGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Source group not found")
    return group

@router.put("/{group_id}", response_model=SourceGroupOut)
def update_source_group(
    group_id: UUID, 
    source_group_update: SourceGroupUpdate, 
    db: Session = Depends(get_db),
    _ = require_role("admin")
):
    """Updates an existing source group."""
    db_group = db.query(SourceGroup).filter(SourceGroup.id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Source group not found")
    
    for key, value in source_group_update.model_dump(exclude_unset=True).items():
        setattr(db_group, key, value)
    
    db.commit()
    db.refresh(db_group)
    return db_group

@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source_group(
    group_id: UUID, 
    db: Session = Depends(get_db),
    _ = require_role("admin")
):
    """Deletes a source group. Note: Sources in this group will have their group_id set to NULL."""
    db_group = db.query(SourceGroup).filter(SourceGroup.id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Source group not found")
    
    db.delete(db_group)
    db.commit()
    return None
