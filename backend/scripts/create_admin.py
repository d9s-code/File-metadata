"""One-off CLI to bootstrap the first admin user. Usage:
    python scripts/create_admin.py <username> <password>
"""

import sys

sys.path.insert(0, ".")

from app.core.enums import Role
from app.core.security import hash_password
from app.database import SessionLocal
from app.models.user import User


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python scripts/create_admin.py <username> <password>")
        raise SystemExit(1)
    username, password = sys.argv[1], sys.argv[2]

    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == username).first():
            print(f"User '{username}' already exists.")
            return
        user = User(username=username, password_hash=hash_password(password), role=Role.admin)
        db.add(user)
        db.commit()
        print(f"Created admin user '{username}'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
