import asyncio
import httpx
import zipfile
import io
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from app.database import SessionLocal
from app.models.platform import Platform

# Configuration
API_BASE_URL = "http://localhost:8000"
# Note: In a real test environment, you'd handle authentication.
# For local dev verification, we assume the endpoint is accessible or use a token.
# For this script, we'll assume the user has a valid session or the endpoint is temporarily open.

async def verify_export():
    print("--- PRS Export Verification Script ---")
    
    # 1. Get a valid Platform ID from the database
    print("[1/4] Fetching a valid platform from database...")
    db = SessionLocal()
    try:
        platform = db.query(Platform).filter(Platform.is_deleted == False).first()
        if not platform:
            print("Error: No active platforms found in the database. Please create a platform first.")
            return
        platform_id = str(platform.id)
        platform_name = platform.name
        print(f"Found platform: {platform_name} (ID: {platform_id})")
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return
    finally:
        db.close()

    # 2. Call the export endpoint
    print(f"[2/4] Calling export endpoint: POST {API_BASE_URL}/platforms/{platform_id}/export/prs")
    async with httpx.AsyncClient(base_url=API_BASE_URL, follow_redirects=True) as client:
        try:
            # Note: If your API requires CSRF/Auth, you'll need to add headers here.
            # For local testing, we're assuming access is permitted or cookie-based.
            response = await client.post(f"/platforms/{platform_id}/export/prs")
            
            if response.status_code != 200:
                print(f"Error: Export failed with status {response.status_code}")
                print(f"Response: {response.text}")
                return

            # 3. Verify it is a valid ZIP file
            print("[3/4] Verifying ZIP file integrity...")
            zip_data = io.BytesIO(response.content)
            try:
                with zipfile.ZipFile(zip_data) as z:
                    file_list = z.namelist()
                    print(f"Successfully parsed ZIP. Contents found:")
                    for f in file_list:
                        print(f"  - {f}")
                    
                    # 4. Verify expected structure
                    print("[4/4] Verifying file structure...")
                    expected_patterns = [
                        "*.xml",
                        "emitters/",
                        "platforms/",
                        "dwells/",
                        f"{platform_name}_mdf.xml"
                    ]
                    
                    missing = []
                    for pattern in expected_patterns:
                        # Simple check for presence of directory or file pattern
                        if not any(pattern.replace('*', '') in f for f in file_list):
                            missing.append(pattern)
                    
                    if missing:
                        print(f"Warning: Missing expected components: {missing}")
                    else:
                        print("Success: All expected components found in the ZIP archive.")
                        print("\nVERIFICATION PASSED!")
                        
            except zipfile.BadZipFile:
                print("Error: The response was not a valid ZIP file (BadZipFile).")
                return

        except Exception as e:
            print(f"An error occurred during the request: {e}")
            return

if __name__ == "__main__":
    asyncio.run(verify_export())
