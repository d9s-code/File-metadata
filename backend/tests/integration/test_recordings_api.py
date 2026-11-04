"""Whole recordings: uploaded in parts, read on the server as the browser's
import reads a CSV, looked over, filtered, and snipped into Intercepts."""

import uuid

import pytest

from app.routers import recordings as recordings_router

HEADER = [
    "MissionTime", "TrackNumber", "ModeTrackNumber", "ModeAmbiguityCount", "ModeIdAmbiguities_0_ModeName",
    "ModeIdAmbiguities_0_Designation", "ReceivedPower", "Parameters_RF", "Parameters_PRIClass", "Parameters_BasePRI",
    "Parameters_PulseWidth", "Parameters_Parameters_Simple_Jitter", "Parameters_Parameters_Stagger_Count",
    "Parameters_Parameters_Stagger_Position0", "Parameters_Parameters_Stagger_Position1",
]


def _row(time, track, rf, cls, base_pri="", pw="", jitter="", count="", p0="", p1="", designation="U000A"):
    return [time, track, "1", "1", "Default", designation, "-40.5", rf, cls, base_pri, pw, jitter, count, p0, p1]


def _csv(rows) -> bytes:
    lines = [",".join(HEADER)] + [",".join(str(c) for c in r) for r in rows]
    return ("﻿" + "\n".join(lines) + "\n").encode()


ROWS = [
    # 10 fixed reports on track 11, one a minute from 08:00, RF 3000–3009 MHz, PRI 1000 µs, PW 1 µs.
    *[_row(f"20251201-08{m:02d}00.250000", "11", 3000 + m, "Simple", 1_000_000, 1000, 10) for m in range(10)],
    # 4 staggers on track 12 at 08:30–08:33 (frame 900 µs, positions 400/500 µs).
    *[_row(f"20251201-0830{s:02d}.000000", "12", 9400, "Stagger", 900_000, 800, "", 2, 400_000, 500_000) for s in range(4)],
    # 2 CW on track 13, identified as something else.
    *[_row(f"20251201-0900{s:02d}.000000", "13", 5600, "CW", designation="X999") for s in range(2)],
    # Unreadable: X-let, no RF, a stagger missing a position, a fixed without PW.
    _row("20251201-091000.000000", "14", 3000, "Xlet"),
    _row("20251201-091000.000000", "14", "", "Simple", 1_000_000, 1000),
    _row("20251201-091000.000000", "14", 3000, "Stagger", 900_000, 800, "", 2, 400_000, ""),
    _row("20251201-091000.000000", "14", 3000, "Simple", 1_000_000, ""),
]


def _upload(client, data: bytes, name="pass_EmitterTrackParameters.csv", chunk=None, monkeypatch=None):
    if chunk and monkeypatch:
        monkeypatch.setattr(recordings_router, "CHUNK_BYTES", chunk)
    r = client.post("/recordings", json={"name": name, "size_bytes": len(data)})
    assert r.status_code == 201, r.text
    rec = r.json()
    size = recordings_router.CHUNK_BYTES
    for i in range(0, len(data), size):
        put = client.put(
            f"/recordings/{rec['id']}/chunks/{i // size}",
            content=data[i : i + size],
            headers={"content-type": "application/octet-stream"},
        )
        assert put.status_code == 204, put.text
    done = client.post(f"/recordings/{rec['id']}/complete", params={"wait": "true"})
    assert done.status_code == 200, done.text
    return done.json()


def test_a_recording_is_uploaded_in_parts_and_read_like_the_import(editor_client, monkeypatch):
    rec = _upload(editor_client, _csv(ROWS), chunk=500, monkeypatch=monkeypatch)
    assert rec["status"] == "ready", rec
    assert rec["report_count"] == 16
    assert rec["skipped_count"] == 4
    assert any("X-let" in s for s in rec["skipped_sample"])
    assert rec["first_time"].startswith("2025-12-01T08:00:00.25")
    assert rec["last_time"].startswith("2025-12-01T09:00:01")

    snip = editor_client.get(f"/recordings/{rec['id']}/reports").json()
    rows = [dict(zip(snip["fields"], r)) for r in snip["reports"]]
    fixed = rows[0]
    assert (fixed["file_line"], fixed["pri_type"], fixed["rf_mhz"]) == (2, "fixed", 3000.0)
    assert (fixed["pri_us"], fixed["pw_us"], fixed["jitter_us"]) == (1000.0, 1.0, 0.01)  # ns → µs
    stagger = next(r for r in rows if r["pri_type"] == "stagger")
    assert stagger["pri_us"] == 900.0 and stagger["stagger_us"] == [400.0, 500.0]
    cw = next(r for r in rows if r["pri_type"] == "cw")
    assert cw["pri_us"] is None and cw["designation"] == "X999"


def test_the_overview_and_snips_follow_the_filters(editor_client, monkeypatch):
    rec = _upload(editor_client, _csv(ROWS))
    url = f"/recordings/{rec['id']}"
    ov = editor_client.get(f"{url}/overview").json()
    assert ov["total"] == 16 and ov["by_type"] == {"fixed": 10, "stagger": 4, "cw": 2}
    assert sum(c[2] for c in ov["params"]["rf"]["cells"]) == 16
    assert sum(c[2] for c in ov["params"]["pri"]["cells"]) == 14  # CW has no PRI
    assert sum(n for _b, n in ov["counts"]) == 16
    assert {i["label"]: i["count"] for i in ov["identified"]} == {"U000A": 14, "X999": 2}

    # A time window and an RF range: the fixed reports from 08:03 to 08:06.
    window = {"t0": "2025-12-01T08:03:00Z", "t1": "2025-12-01T08:06:30Z", "rf_min": 3000, "rf_max": 3005}
    assert editor_client.get(f"{url}/overview", params=window).json()["total"] == 3
    snip = editor_client.get(f"{url}/reports", params=window).json()
    assert [r[0] for r in snip["reports"]] == [5, 6, 7]  # file lines
    assert editor_client.get(f"{url}/overview", params={"types": "stagger,cw"}).json()["total"] == 6
    assert editor_client.get(f"{url}/overview", params={"tracks": "12"}).json()["total"] == 4
    assert editor_client.get(f"{url}/overview", params={"identified": "x99"}).json()["total"] == 2
    assert editor_client.get(f"{url}/overview", params={"pri_min": 950}).json()["total"] == 10

    # A snip too big for the grouping tools is refused, with how many it holds.
    monkeypatch.setattr(recordings_router, "MAX_SNIP", 5)
    big = editor_client.get(f"{url}/reports")
    assert big.status_code == 409 and "16" in big.json()["detail"]


def test_an_intercept_snipped_from_a_recording_remembers_it(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "Snip Emitter"}).json()
    rec = _upload(editor_client, _csv(ROWS))
    snip = {"t0": "2025-12-01T08:00:00Z", "t1": "2025-12-01T08:10:00Z", "types": ["fixed"]}
    entry = {
        "pri_type": "fixed", "rf_mean_mhz": 3004.5, "pri_mean_us": 1000, "pw_mean_us": 1, "jitter_mean_us": 0.01,
        "report_count": 10, "source_file": rec["name"],
    }
    r = editor_client.post(
        "/intercepts/import",
        json={
            "intercept": {
                "emitter_id": emitter["id"], "name": "Morning, fixed", "recording_id": rec["id"], "snip": snip,
            },
            "entries": [entry],
        },
    )
    assert r.status_code == 201, r.text
    intercept = r.json()
    assert intercept["recording_id"] == rec["id"] and intercept["recording_name"] == rec["name"]
    assert intercept["snip"] == snip
    listed = editor_client.get(f"/recordings/{rec['id']}").json()["intercepts"]
    assert [(i["name"], i["entry_count"]) for i in listed] == [("Morning, fixed", 1)]

    # Its own Notes, separate from the comment feed.
    notes = "Two emitters on the same track?\n\nCheck the 08:05 jump."
    patched = editor_client.patch(f"/intercepts/{intercept['id']}", json={"analysis_notes": notes})
    assert patched.status_code == 200 and patched.json()["analysis_notes"] == notes

    # Deleting the recording keeps the Intercept, unlinked.
    assert editor_client.delete(f"/recordings/{rec['id']}").status_code == 204
    after = editor_client.get(f"/intercepts/{intercept['id']}").json()
    assert after["recording_id"] is None and after["entry_count"] == 1


def test_the_same_file_again_is_the_same_recording(editor_client):
    first = _upload(editor_client, _csv(ROWS))
    again = _upload(editor_client, _csv(ROWS), name="copy.csv")
    assert again["already_uploaded"] is True and again["id"] == first["id"]
    assert len(editor_client.get("/recordings").json()) == 1


def test_a_file_that_isnt_a_track_export_fails_with_the_reason(editor_client):
    rec = _upload(editor_client, b"a,b,c\n1,2,3\n")
    assert rec["status"] == "failed"
    assert "missing columns" in rec["error"]
    assert editor_client.get(f"/recordings/{rec['id']}/overview").status_code == 409


def test_an_upload_must_arrive_whole_and_only_editors_upload(editor_client, viewer_client):
    r = editor_client.post("/recordings", json={"name": "half.csv", "size_bytes": 1000})
    rid = r.json()["id"]
    editor_client.put(f"/recordings/{rid}/chunks/0", content=b"x" * 400, headers={"content-type": "application/octet-stream"})
    incomplete = editor_client.post(f"/recordings/{rid}/complete")
    assert incomplete.status_code == 409 and "400" in incomplete.json()["detail"]
    too_far = editor_client.put(f"/recordings/{rid}/chunks/5", content=b"x", headers={"content-type": "application/octet-stream"})
    assert too_far.status_code == 422
    assert viewer_client.post("/recordings", json={"name": "v.csv", "size_bytes": 10}).status_code == 403
    assert viewer_client.get("/recordings").status_code == 200


@pytest.mark.parametrize("bad", ['"broken,quote\n', "MissionTime\n"])
def test_unreadable_files_never_leave_reports_behind(editor_client, bad):
    rec = _upload(editor_client, bad.encode())
    assert rec["status"] == "failed" and rec["report_count"] == 0


def test_a_read_cut_short_by_a_restart_says_so_and_keeps_nothing(editor_client, db_session):
    from app.models.recording import Recording, RecordingReport

    rec = _upload(editor_client, _csv(ROWS[:5]))
    # As a server that stopped part-way would leave it: "processing", its reports half in.
    row = db_session.get(Recording, uuid.UUID(rec["id"]))
    row.status = "processing"
    db_session.commit()
    after = editor_client.get(f"/recordings/{rec['id']}").json()
    assert after["status"] == "failed" and "upload the file again" in after["error"]
    assert db_session.query(RecordingReport).filter_by(recording_id=row.id).count() == 0


def test_a_recording_being_read_cant_be_deleted(editor_client, monkeypatch):
    rec = editor_client.post("/recordings", json={"name": "r.csv", "size_bytes": 10}).json()
    editor_client.put(
        f"/recordings/{rec['id']}/chunks/0", content=b"MissionTi\n", headers={"content-type": "application/octet-stream"}
    )

    class NotStarted:  # the read stays "running" for the length of the test
        def __init__(self, **_kw):
            pass

        def start(self):
            pass

    monkeypatch.setattr(recordings_router.threading, "Thread", NotStarted)
    monkeypatch.setattr(recordings_router, "_READING", set())
    assert editor_client.post(f"/recordings/{rec['id']}/complete").json()["status"] == "processing"
    assert editor_client.delete(f"/recordings/{rec['id']}").status_code == 409
