from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.customer import Customer
from app.schemas.customer import CustomerCreate, CustomerOut, CustomerUpdate
from app.services.audit_service import apply_and_diff, record_audit, snapshot

router = APIRouter(prefix="/customers", tags=["customers"])


def _get_customer_or_404(db: Session, customer_id: UUID) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    return customer


@router.get("", response_model=list[CustomerOut])
def list_customers(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[Customer]:
    return db.query(Customer).order_by(Customer.name).all()


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_customer(
    payload: CustomerCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Customer:
    if db.query(Customer).filter(Customer.name == payload.name).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Customer name already exists")
    customer = Customer(name=payload.name)
    db.add(customer)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.customer.value,
        entity_id=customer.id,
        summary=f"Created Customer '{customer.name}'",
        changes=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(customer)
    return customer


@router.patch("/{customer_id}", response_model=CustomerOut, dependencies=[Depends(verify_csrf)])
def update_customer(
    customer_id: UUID,
    payload: CustomerUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Customer:
    customer = _get_customer_or_404(db, customer_id)
    changes = apply_and_diff(customer, payload.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.customer.value,
        entity_id=customer.id,
        summary=f"Updated Customer '{customer.name}'",
        changes=changes,
    )
    db.commit()
    db.refresh(customer)
    return customer


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_customer(
    customer_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> None:
    customer = _get_customer_or_404(db, customer_id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.customer.value,
        entity_id=customer.id,
        summary=f"Deleted Customer '{customer.name}'",
        changes=snapshot(customer, ["name"]),
    )
    db.delete(customer)
    db.commit()
