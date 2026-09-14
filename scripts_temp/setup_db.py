import psycopg2
import sys

def setup(password):
    try:
        # Connect as superuser
        conn = psycopg2.connect(
            dbname="postgres",
            user="postgres",
            password=password,
            host="localhost",
            port="5432"
        )
        conn.autocommit = True
        cur = conn.cursor()

        print("Creating user 'rf_app'...")
        cur.execute("CREATE USER rf_app WITH PASSWORD 'admin';")
        
        print("Creating database 'rf_emitter_db'...")
        cur.execute("CREATE DATABASE rf_emitter_db OWNER rf_app;")

        print("Database setup successful!")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error during setup: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python setup_db.py <postgres_password>")
        sys.exit(1)
    setup(sys.argv[1])
