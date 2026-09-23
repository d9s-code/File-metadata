"""End-to-end smoke test against a running deployment, driven through a real
browser. Creates a throwaway Emitter (deleted again at the end) and checks:

  - login works and the pages load without Content-Security-Policy violations
  - "Export XML" downloads a ZIP, even for a non-Latin name with a slash
  - a pending Source can be rejected with a reason, and approved again later
  - an expired session redirects to /login and comes back to the same page

Usage (needs `pip install playwright`; set PLAYWRIGHT_CHROMIUM to use an
existing Chromium binary instead of Playwright's own download):

    SMOKE_BASE_URL=https://prs.app SMOKE_USER=admin SMOKE_PASSWORD=... \\
        python scripts/smoke_test.py

SMOKE_API_URL defaults to $SMOKE_BASE_URL/api (the Traefik layout); set it
explicitly if the API lives elsewhere. The user needs the editor role.
"""

import io
import os
import sys
import time
import zipfile
from urllib.parse import quote

from playwright.sync_api import Page, expect, sync_playwright

BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://localhost:5173").rstrip("/")
API_URL = os.environ.get("SMOKE_API_URL", f"{BASE_URL}/api").rstrip("/")
USER = os.environ["SMOKE_USER"]
PASSWORD = os.environ["SMOKE_PASSWORD"]
CHROMIUM = os.environ.get("PLAYWRIGHT_CHROMIUM")

EMITTER_NAME = f"Smoke Радар AN/APG-{int(time.time())}"
REJECTION_REASON = "Smoke test: duplicate of an existing report"


def step(message: str) -> None:
    print(f"- {message}", flush=True)


def api(page: Page, method: str, path: str, **kwargs):
    csrf = next(c["value"] for c in page.context.cookies() if c["name"] == "csrf_token")
    resp = page.request.fetch(f"{API_URL}{path}", method=method, headers={"x-csrf-token": csrf}, **kwargs)
    assert resp.ok, f"{method} {path} -> {resp.status}: {resp.text()}"
    return resp.json() if resp.status != 204 and "json" in resp.headers.get("content-type", "") else resp


def login(page: Page) -> None:
    page.locator("input").first.fill(USER)
    page.locator('input[type="password"]').fill(PASSWORD)
    page.locator('button[type="submit"]').click()


def build_fixture(page: Page) -> dict:
    """An Emitter holding one approved Source with a Mode, plus a
    pending-review Source created the way real imported data is: by
    importing the Emitter's own PRS export back into it."""
    emitter = api(page, "POST", "/emitters", data={"name": EMITTER_NAME})
    eid = emitter["id"]
    group = api(page, "POST", f"/emitters/{eid}/ew-groups", data={"name": "Search"})
    source = api(page, "POST", f"/emitters/{eid}/sources", data={"name": "Manual", "source_date": "2026-01-01"})
    api(page, "POST", f"/ew-groups/{group['id']}/modes", data={
        "source_id": source["id"], "name": "Smoke Mode", "pri_type": "cw",
        "line": {"rf_min_mhz": 9000, "rf_max_mhz": 9100, "pw_min_us": 0.1, "pw_max_us": 0.2,
                 "rf_delta": 0, "pw_delta": 0, "rf_range_matching": False,
                 "pw_range_matching": False, "pri_range_matching": False},
    })
    export = zipfile.ZipFile(io.BytesIO(api(page, "POST", f"/emitters/{eid}/export/xml").body()))
    xml_bytes = export.read(export.namelist()[0])
    api(page, "POST", f"/emitters/{eid}/imports/prs-import", multipart={
        "file": {"name": "emitter.xml", "mimeType": "application/xml", "buffer": xml_bytes},
        "new_source_name": "Imported For Review",
    })
    return emitter


def main() -> int:
    csp_violations: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM, args=["--no-sandbox"]) if CHROMIUM else p.chromium.launch()
        context = browser.new_context(accept_downloads=True)
        context.add_init_script(
            "document.addEventListener('securitypolicyviolation', e =>"
            " console.error('CSP violation: ' + e.violatedDirective + ' ' + e.blockedURI));"
        )
        page = context.new_page()
        page.on("console", lambda m: m.type == "error" and "CSP violation" in m.text and csp_violations.append(m.text))
        emitter = None
        try:
            step("login")
            page.goto(f"{BASE_URL}/login")
            login(page)
            page.wait_for_url("**/dashboard")

            step("create a throwaway Emitter with a pending-review Source")
            emitter = build_fixture(page)
            page.goto(f"{BASE_URL}/emitters/{emitter['id']}")
            expect(page.get_by_role("heading", name=EMITTER_NAME)).to_be_visible()

            step("Export XML downloads a ZIP")
            with page.expect_download() as download_info:
                page.get_by_role("button", name="Export XML").click()
            downloaded = zipfile.ZipFile(download_info.value.path())
            assert len(downloaded.namelist()) == 1 and "/" not in downloaded.namelist()[0].removeprefix("emitters/"), downloaded.namelist()

            step("reject the pending Source with a reason")
            page.get_by_role("button", name="EW Groups & Sources").click()
            row = page.locator("tr:visible", has_text="Imported For Review").first
            row.get_by_role("button", name="Reject").click()
            page.get_by_label("Reason for rejecting").fill(REJECTION_REASON)
            page.get_by_role("button", name="Reject Source").click()
            expect(row.get_by_text(f"Rejected: {REJECTION_REASON}")).to_be_visible()

            step("approve the rejected Source afterwards")
            row.get_by_role("button", name="Approve").click()
            expect(row.get_by_text("Rejected:")).to_have_count(0)
            expect(row.locator(".status-badge")).to_have_count(0)

            step("an expired session redirects to login and back")
            here = f"/emitters/{emitter['id']}"
            context.clear_cookies(name="access_token")
            page.get_by_role("button", name="Export XML").click()  # any request now gets a 401
            page.wait_for_url(f"**/login?next={quote(here, safe='')}")
            expect(page.get_by_text("Your session expired")).to_be_visible()
            login(page)
            page.wait_for_url(f"**{here}")
            expect(page.get_by_role("heading", name=EMITTER_NAME)).to_be_visible()

            assert not csp_violations, csp_violations
            print("PASS")
            return 0
        except Exception as exc:  # noqa: BLE001 - report any failure and keep the screenshot
            page.screenshot(path="smoke_test_failure.png", full_page=True)
            print(f"FAIL: {exc}\nScreenshot: smoke_test_failure.png")
            return 1
        finally:
            if emitter is not None:
                try:
                    api(page, "DELETE", f"/emitters/{emitter['id']}")
                except Exception as exc:  # noqa: BLE001
                    print(f"(cleanup failed: {exc})")
            browser.close()


if __name__ == "__main__":
    sys.exit(main())
