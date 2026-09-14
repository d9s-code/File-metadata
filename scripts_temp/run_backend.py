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
    
    print("Starting Uvicorn...")
    # We use subprocess.run to execute the command in the new directory
    # Note: This will block the script while the server is running
    result = subprocess.run([venv_python, "-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"])
    
    if result.returncode == 0:
        print("Server stopped gracefully.")
    else:
        print(f"Server exited with code {result.returncode}")

if __name__ == "__main__":
    run()
