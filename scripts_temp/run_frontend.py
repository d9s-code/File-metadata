import os
import subprocess
import sys

def run():
    frontend_dir = r'c:\Users\dyildirim\Desktop\prosjekter\File-metadata\frontend'
    # We use the node command from the system path
    
    if not os.path.exists(frontend_dir):
        print(f"Error: Frontend directory not found at {frontend_dir}")
        sys.exit(1)

    print(f"Changing directory to: {frontend_dir}")
    os.chdir(frontend_dir)
    
    print("Starting Vite frontend server...")
    # We use subprocess.run to execute the command in the new directory
    # shell=True is used on Windows to ensure 'npm' is found in the PATH
    result = subprocess.run("npm run dev", capture_output=False, shell=True)
    
    if result.returncode == 0:
        print("Frontend server stopped gracefully.")
    else:
        print(f"Frontend server exited with code {result.returncode}")

if __name__ == "__main__":
    run()
