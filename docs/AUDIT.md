# App audit: 2026-09-23

Audited at `ccd3eec` on branch `app-audit`. The audit covers security, data integrity, correctness, performance, tests, dependencies, deployment, and repo hygiene.

**Status:** fixes are on branch `audit-fixes`. Everything below is fixed there except **#6**, the choice between the two PRS exporters. That one needs someone to check the output against a real PRS file; see [Open decision: which PRS export format is correct](#open-decision-which-prs-export-format-is-correct). The findings further down are kept as originally written; the Status column says what changed.

## How this was checked

- Every API route was listed from the live FastAPI app, together with its auth, CSRF, and checkout guards.
- The risky paths were probed against the running app with a real database: XXE, entity expansion, export filenames, soft delete, and a second editor writing to an Emitter while someone else holds the checkout.
- `pip-audit` was run on `backend/requirements.txt`, and `npm audit` on the frontend.
- `alembic check` compared the models against the migrations.
- `tsc -b` and `oxlint` were run on the frontend.
- Backend route test coverage was estimated by matching each route against the test calls.

## Summary

| # | Sev | Finding | Proposed change | Status |
|---|-----|---------|-----------------|--------|
| 1 | High | Backend dependencies have known CVEs. Multipart-parser DoS bugs can be triggered **without logging in**. | Upgrade `fastapi`/`starlette`, `python-multipart`, `pyjwt`, `lxml`, and `deepdiff`. Cap the upload size. | Fixed. All six packages are upgraded, and pip-audit is clean. Uploads are capped at 10 MB in the backend (413) and 20 MB at Traefik. Dev dependencies are in `requirements-dev.txt`. |
| 2 | High | The app starts with a publicly known JWT secret if none is configured. Compose ships `CHANGE_ME` placeholders for the secret and the admin password. | Refuse to start when the secret or admin password is a default or placeholder value. | Fixed. The backend won't start with a default, `CHANGE_ME`, or short secret unless `APP_ENV=dev`. `create_admin.py` refuses weak passwords. |
| 3 | High | Approving or rejecting a Source changes nothing downstream: Modes from rejected Sources are still exported, versioned, and analysed. | **Decision:** what "rejected" and "pending" should exclude. Then filter on it in export, snapshots, and ambiguity runs. | Fixed as decided: rejecting requires a reason, and a rejected Source can be approved again later. Its Modes are left out of both exporters and ambiguity checks. The status is versioned. PRS import creates pending Sources. |
| 4 | High | Some Emitter writes skip the checkout lock. Another editor can delete the Emitter, delete a generation batch of Modes, JSON-import Sources, or commit a version while someone else is editing. | Require the checkout on these routes. For delete, allow the lock holder or an Admin. | Fixed, and the UI disables these actions without the checkout. |
| 5 | Med | Exporting an Emitter or Platform with a non-Latin name returns a 500 error. Names containing `/` create nested folders in the ZIP. | Use an RFC 6266 `filename*=` header, and use `sanitize_filename` for ZIP entry paths. | Fixed. ZIP entries and `EmitterFile` references now use the same name. |
| 6 | Med | Two separate PRS exporters produce different XML for the same data. | Make the live export build a snapshot and reuse `prs_export`. Delete `XMLExporterService`. | **Open, needs a decision.** Filename bugs and rejected-Source filtering were fixed in both exporters. |
| 7 | Med | A soft-deleted Emitter still reserves its name for 30 days, and it can still be checked out and edited. | Use a partial unique index on active names only, and return 404 for deleted Emitters on write routes. | Fixed for Emitters, Platforms, and MDFs. Renaming to a taken name now returns 409 instead of a 500. |
| 8 | Med | When the session expires after 8 hours, the UI stays "logged in" and every action fails with "Invalid or expired token". | Clear the user and redirect to `/login` on any 401 response. | Fixed. You return to the same page after signing in again. |
| 9 | Med | Four `async def` routes run blocking database and ZIP work on the event loop. A large export stalls every other request. | Change them to plain `def`, and read the upload with `file.file.read()`. | Fixed. |
| 10 | Med | About 46 backend routes are never called by a test, including JSON import, Source approve/reject, parameter sequences, source groups, and trash purge. The frontend has no tests. | Add integration tests for the write paths first. | Fixed for the listed paths (51 new backend tests; the suite went from 308 to 359). Added `scripts/smoke_test.py`, a browser smoke test. |
| 11 | Low | Hardening gaps: username-only rate limit, no password minimum length, `/docs` is public, the image runs as root with pytest installed, nginx sends no security headers, and a checkout race exists. | See details. | Fixed: per-IP limit and constant-time login, 12–72 character passwords, docs only in dev, a non-root image, CSP and other nginx headers, and a row-locked checkout. Token revocation on logout is still out of scope. |
| 12 | Low | Repo hygiene: stray debug files, a local Windows config file, and dead code. | Delete them. | Fixed. `scripts/verify_export.py`, which called a route that doesn't exist, was also removed. |

**Checked and fine:**
- Every route requires authentication, apart from `/auth/login`, `/auth/logout`, and `/health`.
- Every state-changing route checks the CSRF token. The five that don't are read-only: the export, validate, and parse endpoints.
- Roles and the "active" flag are re-read from the database on every request, not trusted from the token.
- XXE and entity-expansion ("billion laughs") attacks on the PRS import are rejected by lxml. The parser is now also hardened explicitly.
- Migrations match the models.
- The frontend type-checks and lints clean.
- `npm audit` reports 0 vulnerabilities.

---

## Open decision: which PRS export format is correct

The app has two exporters that write the same PRS format:

| Exporter | Used by | Code |
|---|---|---|
| "Export XML" button | the Emitter and Platform pages | `app/services/xml_export/xml_exporter_service.py` |
| Versioned PRS export | a committed Platform or MDF version | `app/services/prs_export/` |

To compare them, the same Emitter and Platform were exported through both. Their output differs as follows:

| | "Export XML" button | Versioned PRS export |
|---|---|---|
| MDF namespace | `urn:com:bae:xml:pfm:library` | `urn:com:bae:prs:pfm:library` |
| Platform `Base` / `Speed` | `SEA`, 10–1020 knots | `UNKNOWN`, 0–0 kph |
| Number format | `2899.0000` | `2899` |
| CW PRI | `<PRI Class="CW"><CW/></PRI>` | `<PRI Class="CW"/>` |
| `Intrapulse` element position | right after `LethalCeiling` | after the `Scan` elements |
| Xlet placeholder ranges | `Max="1"` | `Max="0"` |
| `Scan Period` | widened by the EW Group's `scan_delta` | raw `scan_min`/`scan_max` (version snapshots don't capture `scan_delta`) |
| Which Emitter data a Platform export uses | the Emitter's **live** state | the Emitter version **pinned** to the Platform |
| `default_unknown_*.xml` files | referenced by the MDF file, but missing from the ZIP | included |

Evidence in the repo:
- `prs_export/serializer.py` says its tags and namespace were copied from the target system's own sample files (`Profile_format/`: `Example MDF.xml`, `PRS_FORMAT_EMITTER.xml`). Those files aren't in the repo.
- `ExportPrsButton.tsx` calls the "Export XML" button a "placeholder" using a "legacy single-file format".
- On the other hand, the in-app PRS importer was written against the button's output, and that's what the team has been using.

**To decide:** compare either export against one of the real sample files. The MDF namespace and the CW PRI element are the quickest tells. Once the correct format is known, the other exporter can be removed and every export routed through a single serializer.

---

## Details

### 1. Vulnerable backend dependencies (High)

`pip-audit` found 46 advisories across six packages:

| Package | Pinned | Fixed in | Relevance here |
|---|---|---|---|
| starlette (via fastapi 0.115.6) | 0.41.3 | 0.49.1+ (1.3.1 for all) | Multipart DoS; the form limits are ignored for urlencoded bodies. |
| python-multipart | 0.0.20 | 0.0.31 | Several multipart and querystring parsing DoS bugs. |
| pyjwt | 2.10.1 | 2.13.0 | `crit` header not validated; the others don't apply (no JWKS or asymmetric keys). |
| lxml | 5.3.0 | 6.1.0 | Default-config XXE. Probed as **not** exploitable in this build, but it's one config change away. |
| deepdiff | 8.1.1 | 8.6.2 | Class pollution and unpickler issues. Only used on internal snapshots, so low exposure. |
| pytest | 8.3.4 | 9.0.3 | Dev only, but it currently ships in the runtime image (see #11). |

**Why the multipart bugs are reachable without an account:** FastAPI parses the request body before it runs the route's dependencies. An unauthenticated POST to `/emitters/{id}/imports/prs-import` was confirmed to run the multipart parser before the request was rejected with a 403.

There is also no upload size limit: `imports.py:62` and `imports.py:179` read the whole file into memory with `await file.read()`.

**Proposed changes:**
- Bump the packages above and re-run the suite.
- Enforce a maximum body size in Traefik (`buffering.maxRequestBodyBytes`) and in the route. A few MB is plenty for an Emitter XML.
- Parse XML with an explicit hardened parser (`resolve_entities=False, no_network=True`) so safety doesn't depend on library defaults.
- Split dev dependencies into a `requirements-dev.txt`.

### 2. Insecure secret defaults (High)

- `app/config.py:16` defaults `jwt_secret` to `"dev-only-insecure-secret-change-me"`. If `JWT_SECRET` is missing in production, anyone who has read this repo can mint an admin token.
- `docker-compose.yml:22` sets `JWT_SECRET` to `CHANGE_ME_generate_with_openssl_rand_hex_32`.
- `docker-compose.yml:29` sets `ADMIN_PASSWORD` to `CHANGE_ME`. `create_admin.py` will happily create `admin` / `CHANGE_ME`.

**Proposed change:** add a startup check that exits when the JWT secret is the default, contains `CHANGE_ME`, or is shorter than 32 characters, unless an explicit `APP_ENV=dev` is set. `create_admin.py` should apply the same rule to `CHANGE_ME` passwords.

### 3. Source review status has no effect (High, Decision)

`SourceStatus` (`approved` / `pending_review` / `rejected`, `app/core/enums.py:82`) is only read in two places: the dashboard's pending count, and the approve/reject transitions. None of these filter on it:
- the XML exporters
- `build_emitter_snapshot`
- ambiguity runs
- the Modes list

So a rejected Source's Modes still reach the PRS library export.

The new PRS import creates its Source with the model default `approved` (`imports.py:201`). The JSON import creates `pending_review`, which is inconsistent.

**Decision needed:**
- Should `rejected` Sources be excluded everywhere?
- Should `pending_review` Sources be excluded from export and versioning only, or be visible but flagged?

**Proposed change:** once the policy is set, filter on it in one shared query helper. Make the PRS import create `pending_review` Sources, like the JSON import does.

### 4. Writes that bypass the checkout lock (High)

Confirmed by running each as a second editor while the first editor held the checkout:

| Route | Guard today | Result as the second editor |
|---|---|---|
| `DELETE /emitters/{id}` (`emitters.py:131`) | editor role | **204**: deleted someone else's in-progress Emitter |
| `POST /emitters/{id}/versions` (`emitters.py:511`) | editor role | **201**: committed another user's half-finished edits as a version |
| `DELETE /emitters/{id}/generation-batches/{id}` (`emitters.py:456`) | editor role | deletes Modes; no checkout check in the code |
| `POST /emitters/{id}/imports` and `/imports/json-import` (`imports.py:47`, `:108`) | editor role | creates Sources; no checkout check in the code |

For comparison, editing a Mode under the same conditions correctly returns 409.

**Proposed change:**
- Use `require_emitter_checkout()` on the generation-batch delete, the JSON import commit, and the version commit. The Version History page's Commit button already implies holding the lock.
- For Emitter delete, allow it when there is no holder, when the caller is the holder, or when the caller is an Admin.

### 5. Export filename crashes and paths (Med)

- **Non-Latin names:** `emitters.py:754` and `platforms.py:355` put the raw name into `Content-Disposition`. An Emitter named `Радар AN/APG-9` makes the export raise `UnicodeEncodeError`, which surfaces as a 500. The same raw header breaks on quotes and semicolons.
- **Names with `/`:** `xml_exporter_service.py:40,44,80` builds ZIP paths from the name, with at most spaces replaced. `AN/APG-9 x` exports as `emitters/AN/APG-9_x.xml`, which is a nested folder. `prs_export.sanitize_filename` already solves this and even documents the `AN/APG-99` case, but the live exporter doesn't use it.

**Proposed change:**
- Send `filename*=UTF-8''<percent-encoded>` plus an ASCII fallback.
- Use `sanitize_filename` for every ZIP entry name.
- Add a test with a non-Latin name containing a slash.

### 6. Two PRS exporters that disagree (Med)

The same PRS format is produced two ways:

| Exporter | Used by | Data source |
|---|---|---|
| `app/services/xml_export/xml_exporter_service.py` | the "Export XML" buttons | live ORM rows |
| `app/services/prs_export/` | versioned Platform/MDF exports | committed snapshots |

They already differ:

| Field | `xml_exporter_service` | `prs_export` |
|---|---|---|
| Platform `Speed` | 10–1020 knots | 0–0 kph |
| Platform `Base` | `SEA` | `UNKNOWN` |
| Xlet `FramePeriod` / `XletsPerGroup` etc. | `Max="1"` | `Max="0"` |
| Xlet with no `type_data` | empty `<PRI Class="Xlet"/>` | always emits the children |

Fixes applied to one exporter don't reach the other. The slash fix in #5 is an example.

`XMLExporterService.export_mdf_to_zip` is an empty stub that is never called. It references an undefined name (`MDF`, which was imported as `Mdf`), so it would raise `NameError` if called.

**Proposed change:** have the live export build a snapshot with `build_emitter_snapshot` and pass it to `prs_export`'s serializer, then delete `XMLExporterService`. The PRS importer's round-trip tests keep the format honest.

### 7. Soft-deleted Emitters (Med)

Confirmed on the running app:
- `emitters.name` has a plain unique index (baseline migration). A deleted Emitter blocks its name until `purge_deleted.py` removes it, up to 30 days later: recreating the name returns "Emitter name already exists". The restore endpoint's "An active Emitter named … already exists" message can therefore never trigger.
- A deleted Emitter can still be checked out (200) and PATCHed (200), because `_get_emitter_or_404` (`emitters.py:200`) doesn't check `is_deleted`.

**Proposed change:**
- Replace the index with a partial unique index `WHERE NOT is_deleted`. This needs a migration.
- Make write routes return 404 for deleted Emitters; restore stays the only way back.

### 8. Expired session isn't handled in the UI (Med)

The JWT cookie lasts 8 hours (`jwt_expire_minutes=480`). After it expires:
- `AuthContext` still holds the user.
- Every query and mutation fails with "Invalid or expired token".
- The user is never sent back to `/login`, and in-progress form input is lost when they navigate away.

**Proposed change:** in `api/client.ts`, on a 401 from any route except `/auth/*`, clear the auth state and redirect to `/login?next=<current path>`.

### 9. Blocking work inside `async def` routes (Med)

These routes are declared `async def`, but they do synchronous SQLAlchemy work and build ZIPs in-process:
- `platforms.py:340` `export_platform_xml`
- `emitters.py:739` `export_emitter_xml`
- `imports.py:47` `commit_json_import`
- `imports.py:158` `commit_prs_import`

In an `async def` route that work runs on the event loop itself. The backend runs as a single uvicorn worker, so while one large export runs, every other user's requests wait. Plain `def` routes run in a threadpool instead.

**Proposed change:** make them plain `def`, and read the upload with `file.file.read()`. `XMLExporterService`'s methods also don't need to be `async`, and #6 removes them anyway.

### 10. Test coverage gaps (Med)

About 46 of 150 routes are never called by a backend test. The matching was approximate. The write paths that matter most:
- JSON import: `/imports/validate`, `/imports`, and `/imports/json-import`, with no tests at all.
- Source approve/reject, and Source PATCH/DELETE.
- Parameter sequences: all 5 routes.
- Source groups: all 5 routes.
- Trash purge (`DELETE /trash/...`), plus restore for Emitters, Platforms, and MDFs.
- EW Group delete and Test Record delete.

The frontend has no tests. The Playwright smoke scripts used during development live outside the repo.

Tests build the schema with `create_all` rather than running migrations. This is fine today, since `alembic check` is clean, but it isn't exercised in CI.

**Proposed change:**
- Add integration tests for the routes above. Start with the JSON import and the #4 guards.
- Commit a small Playwright smoke suite covering login, creating a Mode, the PRS import round-trip, and export.

### 11. Hardening (Low)

- **Rate limiting:** login attempts are limited per username only, in memory (`core/rate_limit.py`). There is no per-IP limit, and an unknown username skips bcrypt, so response timing reveals which usernames exist (`auth.py:28`). Proposed: also limit per IP, and verify against a dummy hash for unknown users.
- **Passwords:** there is no minimum length (`schemas/user.py`). Bcrypt also silently ignores everything after the first 72 bytes. Proposed: require 12 to 72 characters.
- **API docs:** `/docs`, `/redoc`, and `/openapi.json` are public. Proposed: disable them outside dev.
- **Container:** the backend image runs as root and ships pytest. Proposed: add a non-root `USER`, and drop dev dependencies (#1).
- **nginx:** sends no `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, or `Referrer-Policy` headers, and no long-cache headers for the hashed `/assets/`. Proposed: add them in `frontend/nginx.conf`.
- **Checkout race:** `checkout_service.start_checkout` reads, then writes, without a row lock. Two simultaneous "Start editing" clicks can both get a 200, and the loser only finds out on their first save. Proposed: `SELECT … FOR UPDATE`, or a conditional `UPDATE … WHERE checked_out_by_id IS NULL`.
- **Logout:** logout doesn't revoke the token. A copied cookie stays valid until it expires, and so do tokens issued before a password change. Acceptable at 8 hours, but worth noting.

### 12. Repo hygiene (Low)

All of these are tracked in git:
- `output.log`: a UTF-16 PowerShell "python was not found" error.
- `final_test.py`: a one-off script with a hard-coded Emitter UUID and `admin` / `admin`.
- `scripts_temp/`: five one-off launch and setup helpers.
- `.claude/launch.json`: absolute `C:\Users\<name>\…` paths from one developer's machine.
- Dead code: `XMLExporterService.export_mdf_to_zip` (#6), and the `initialData` edit path in `components/modes/ModeForm.tsx`, which is never passed by any caller; `ModeEditForm` is the real edit form.

**Proposed change:** delete them. Add `*.log` and `.claude/launch.json` to `.gitignore`.

---

## Suggested order

1. #2 and #1: config guard and dependency bumps, plus the upload size cap. Small and mechanical.
2. #4 and #5: checkout guards and the export filename fixes, with tests.
3. #3: needs the decision first, then a small filter change.
4. #6, #7, #8, #9: exporter consolidation, soft-delete semantics, the 401 redirect, and the async routes.
5. #10, #11, #12: tests, hardening, and cleanup.
