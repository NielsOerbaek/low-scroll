"""One-time script to create the initial admin user."""
import sys
from src.config import Config
from src.db import Database


def main():
    if len(sys.argv) != 3:
        print("Usage: python -m seed_admin <email> <password>")
        sys.exit(1)
    email, password = sys.argv[1], sys.argv[2]

    try:
        from argon2 import PasswordHasher
    except ImportError:
        print("Install argon2-cffi: pip install argon2-cffi")
        sys.exit(1)

    ph = PasswordHasher()
    password_hash = ph.hash(password)

    config = Config()
    db = Database(config.DATABASE_PATH)
    db.initialize()
    user_id = db.insert_user(email, password_hash)
    # Mark as admin
    db.execute("UPDATE users SET is_admin=1 WHERE id=?", (user_id,))
    db.conn.commit()
    print(f"Admin user created: {email} (id={user_id})")
    db.close()


if __name__ == "__main__":
    main()
