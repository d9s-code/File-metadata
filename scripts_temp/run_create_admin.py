import os
import subprocess
import sys

def run():
    backend_dir = r'c:\Users\dyildirim\Desktop\prosjekter\File-metadata\backend'
    venv_python = os.path.join(backend_dir, '.venv', 'Scripts', 'python.exe')
    
    if not os.path.exists(venv_python):
        print(f"Error: Python interpreter not found at {venv_python}")
        sys.exit(1)

    print(f"Changing directory to: {backend_dir}")
    os.chdir(backend_dir)
    
    print("Running create_admin.py...")
    # Using the venv python to run the script within the backend directory
    result = subprocess.run([venv_python, "scripts/create_admin.py", "admin", "admin"], capture_output=False)
    
    if result.returncode == 0:
        print("Admin creation command completed.")
    else:
        print(f"Admin creation command exited with code {result.returncode}")

if __name__ == "__main__":
    run()
