import os
import subprocess
import sys

def run():
    backend_dir = r'c:\Users\dyildirim\Desktop\prosjekter\File-metadata\backend'
    venv_alembic = os.path.join(backend_dir, '.venv', 'Scripts', 'alembic.exe')
    
    if not os.path.exists(venv_alembic):
        print(f"Error: Alembic not found at {venv_alembic}")
        sys.exit(1)

    print(f"Changing directory to: {backend_dir}")
    os.chdir(backend_dir)
    
    print("Running alembic upgrade head...")
    # We use subprocess.run to execute the command in the new directory
    result = subprocess.run([venv_alembic, 'upgrade', 'head'], capture_output=True, text=True)
    
    if result.returncode == 0:
        print("Success:")
        print(result.stdout)
    else:
        print("Error:")
        print(result.stderr)
        print(result.stdout)

if __name__ == "__main__":
    run()
