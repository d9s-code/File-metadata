import urllib.request
import urllib.parse
import json
import os
import http.cookiejar

# Configuration
BASE_URL = "http://localhost:8000"
XML_FILE = "test_emitter.xml"
EMITTER_ID = "2c6ca11d-9779-45eb-9b75-fc50f87ac448"

def run_test():
    cookie_jar = http.cookiejar.CookieJar()
    
    print(f"--- Starting End-to-End Test (using urllib) ---")
    
    # 1. Login
    print("Step 1: Logging in...")
    login_url = f"{BASE_URL}/auth/login"
    login_data = urllib.parse.urlencode({'username': 'admin', 'password': 'admin'}).encode('utf-8')
    
    try:
        req = urllib.request.Request(login_url, data=login_data, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        with urllib.request.urlopen(req, context=None) as resp:
            if resp.status != 200:
                print(f"Login failed: {resp.status} - {resp.read().decode()}")
                return
            print("Login successful.")
    except Exception as e:
        print(f"Login request failed: {e}")
        return

    # 2. Extract CSRF token from cookies
    csrf_token = None
    for cookie in cookie_jar. 만들어진_cookies_if_any_logic_is_hard_with_urllib_but_let_s_try:
        # Actually, urllib.request.urlopen with a CookieJar handles this automatically
        pass
    
    # Wait, urllib's CookieJar works by passing it to the opener.
    # Let's use a simpler way to extract CSRF if it's in the cookie jar.
    # For the sake of simplicity in a one-off script, I'll manually parse the jar if needed,
    # but urlopen should have populated it.
    
    # Let's find the csrf_token in the cookie jar
    for cookie in cookie_jar.make_cookies(resp.getheader('Set-Cookie') if resp.getheader('Set-Cookie') else ""):
        # This is getting complex. Let's just use the jar.
        pass

    # Let's use a more robust approach for the cookie jar with urllib
    opener = urllib.request.build_opener(http.cookiejar.HTTPCookieProcessor(cookie_jar))
    urllib.request.install_opener(opener)

    # Re-do login with the opener to ensure cookies are stored in the jar
    print("Re-logging to populate cookie jar...")
    req = urllib.request.Request(login_url, data=login_data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req) as resp:
        if resp.status != 200:
            print(f"Login failed: {resp.status}")
            return

    # Now find the CSRF token in the jar
    csrf_token = None
    for cookie in cookie_jar:
        if cookie.name == 'csrf_token':
            csrf_token = cookie.value
            break
    
    if not csrf_token:
        print("Error: No CSRF token found in cookies.")
        return
    print(f"Captured CSRF token: {csrf_token}")

    # 3. Upload XML
    print(f"Step 2: Uploading {XML_FILE}...")
    upload_url = f"{BASE_URL}/emitters/{EMITTER_ID}/imports/xml"
    
    if not os.path.exists(XML_FILE):
        print(f"Error: {XML_FILE} not found.")
        return

    # Construct multipart/form-data manually or use a library. 
    # Since I can'</code>
