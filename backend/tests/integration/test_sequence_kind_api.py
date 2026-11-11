"""A Parameter Sequence's kind — a stagger or a dwell & switch: guessed from
its steps until set (by hand, or by an import's "sequence-type"), and what
Element coverage checks it against."""

import json

import pytest

from app.services.json_import.transformer import transform_json_to_payload
from app.services.sequence_kind import guess_kind, parse_kind


def _steps(*steps):
    return [{"order": i, **st} for i, st in enumerate(steps)]


@pytest.mark.parametrize(
    ("steps", "kind"),
    [
        # Only PRI: a stagger.
        (_steps({"pri_us": 700}, {"pri_us": 750}, {"pri_us": 1200}), "stagger"),
        # No PRI: it can't be a stagger.
        (_steps({"rf_mhz": 9000}, {"rf_mhz": 9100}), "dwell_switch"),
        # The RF changes between steps: a dwell & switch.
        (_steps({"rf_mhz": 9000, "pri_us": 800}, {"rf_mhz": 9200, "pri_us": 900}), "dwell_switch"),
        # A dwell time on a step: a dwell & switch.
        (_steps({"pri_us": 800, "pw_us": 1, "dwell_s": 0.1}, {"pri_us": 900, "pw_us": 1}), "dwell_switch"),
        # PRI with an unchanging PW (often carried, not used): a stagger.
        (_steps({"pri_us": 800, "pw_us": 1}, {"pri_us": 900, "pw_us": 1}), "stagger"),
    ],
)
def test_the_guess(steps, kind):
    assert guess_kind(steps) == kind


@pytest.mark.parametrize(
    ("raw", "kind"),
    [("Stagger", "stagger"), ("dwell-switch", "dwell_switch"), ("Dwell & Switch", "dwell_switch"),
     ("dwell_and_switch", "dwell_switch"), ("", None), (None, None)],
)
def test_import_spellings(raw, kind):
    assert parse_kind(raw) == kind


def test_an_unknown_import_spelling_is_an_error():
    with pytest.raises(ValueError, match="Unknown sequence type 'burst'"):
        parse_kind("burst")


def _json(groups, **set_meta):
    return [{"file": "f.xml", "notation": "N", "parametric_sets": [
        {"set_id": "SET", "date_last_updated": "10-06-2015 17:19:28 GMT", **set_meta, "groups": groups}
    ]}]


def _seq(name, steps, **extra):
    return {"type": "sequence", "name": name, "steps": steps, **extra}


PRI_STEPS = [{"step-num": "1", "pri-value": {"min": "800", "max": "800"}}, {"step-num": "2", "pri-value": {"min": "900", "max": "900"}}]
RF_STEPS = [{"step-num": "1", "rf-value": {"min": "9000", "max": "9000"}}, {"step-num": "2", "rf-value": {"min": "9100", "max": "9100"}}]


def test_json_import_reads_the_sequence_type():
    payload = transform_json_to_payload(_json(
        [_seq("A", PRI_STEPS, **{"sequence-type": "dwell-switch"}), _seq("B", PRI_STEPS), _seq("C", RF_STEPS)],
        **{"sequence-type": "Stagger"},
    ))
    kinds = {s.label: s.kind for s in payload.parametric_sets[0].sequences}
    # The sequence's own wins; the set's applies to the rest — but not to one
    # without PRI, which can't be a stagger and is left to be guessed.
    assert kinds == {"A": "dwell_switch", "B": "stagger", "C": None}


def test_json_import_without_a_type_leaves_it_guessed(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Kinds"}).json()["id"]
    resp = editor_client.post(
        f"/emitters/{eid}/imports/json-import",
        files={"file": ("k.json", json.dumps(_json([_seq("A", PRI_STEPS)])).encode(), "application/json")},
        data={"source_date": "2026-03-01"},
    )
    assert resp.status_code == 201, resp.text
    source = editor_client.get(f"/emitters/{eid}/sources").json()[0]
    [seq] = editor_client.get(f"/emitters/{eid}/sources/{source['id']}/parameter-sequences").json()
    assert seq["kind"] is None
    assert seq["guessed_kind"] == "stagger"


def test_json_import_with_an_unknown_type_is_refused(editor_client):
    eid = editor_client.post("/emitters", json={"name": "Kinds"}).json()["id"]
    resp = editor_client.post(
        f"/emitters/{eid}/imports/json-import",
        files={"file": ("k.json", json.dumps(_json([_seq("A", PRI_STEPS, **{"sequence-type": "burst"})])).encode(), "application/json")},
        data={"source_date": "2026-03-01"},
    )
    assert resp.status_code == 422
    assert "Unknown sequence type 'burst'" in resp.text


def _coverage_setup(client):
    """A Fixed Mode at RF 9000–9100 / PRI 995–1005 / PW 0.5–1.5, a Stagger
    Mode [1000, 1100] at the same RF and PW, and a sequence whose PRI steps
    are both — so its kind decides what covers it."""
    eid = client.post("/emitters", json={"name": "Kind coverage"}).json()["id"]
    group = client.post(f"/emitters/{eid}/ew-groups", json={"name": "Search"}).json()
    source = client.post(f"/emitters/{eid}/sources", json={"name": "Report", "source_date": "2026-01-01"}).json()
    line = {"rf_min_mhz": 9000, "rf_max_mhz": 9100, "rf_delta": 0, "pw_min_us": 0.5, "pw_max_us": 1.5, "pw_delta": 0,
            "rf_range_matching": False, "pw_range_matching": False, "pri_range_matching": False}
    for name, pri_type, extra in (
        ("Fixed 1000", "fixed", {"pri_min_us": 995, "pri_max_us": 1005, "pri_delta": 0, "jitter_min_us": 0, "jitter_max_us": 1}),
        ("Stagger", "stagger", {"pri_stagger_values_us": [1000, 1100], "frame_time_delta_us": 5}),
    ):
        resp = client.post(f"/ew-groups/{group['id']}/modes",
                           json={"source_id": source["id"], "name": name, "pri_type": pri_type, "line": {**line, **extra}})
        assert resp.status_code == 201, resp.text
    seqs = f"/emitters/{eid}/sources/{source['id']}/parameter-sequences"
    resp = client.post(seqs, json={"label": "Two PRIs", "steps": _steps(
        {"pri_us": 1000, "rf_mhz": 9050, "pw_us": 1}, {"pri_us": 1100, "rf_mhz": 9050, "pw_us": 1})})
    assert resp.status_code == 201, resp.text
    return eid, seqs, resp.json()


def _row(client, eid):
    rows = client.get(f"/emitters/{eid}/element-coverage").json()["elements"]
    return next(r for r in rows if r["sequence"] and r["sequence"]["label"] == "Two PRIs")


def test_coverage_follows_the_kind(editor_client):
    eid, seqs, seq = _coverage_setup(editor_client)
    # Same RF and PW every step, no dwell: guessed a stagger — the Stagger Mode covers it.
    row = _row(editor_client, eid)
    assert row["sequence"]["kind"] == "stagger" and row["sequence"]["kind_guessed"] is True
    assert row["coverage"] == "covered"
    assert [c["name"] for c in row["covered_by"]] == ["Stagger"]

    # Marked a dwell & switch: each step needs a Fixed Mode — only the first has one.
    resp = editor_client.patch(f"{seqs}/{seq['id']}", json={"kind": "dwell_switch"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["kind"] == "dwell_switch"
    row = _row(editor_client, eid)
    assert row["sequence"]["kind"] == "dwell_switch" and row["sequence"]["kind_guessed"] is False
    assert row["coverage"] == "partial"
    assert "step 2" in row["note"]
    assert [c["name"] for c in row["covered_by"]] == ["Fixed 1000"]

    # Back to guessed.
    assert editor_client.patch(f"{seqs}/{seq['id']}", json={"kind": None}).json()["kind"] is None
    assert _row(editor_client, eid)["sequence"]["kind_guessed"] is True

    audit = editor_client.get("/audit-log", params={"emitter_id": eid}).json()["items"]
    summaries = [a["summary"] for a in audit]
    assert "Marked Parameter Sequence 'Two PRIs' as Dwell & switch" in summaries
    assert "Parameter Sequence 'Two PRIs' back to a guessed kind" in summaries


def test_a_dwell_switch_step_needs_one_mode_for_all_its_values(editor_client):
    eid, seqs, _ = _coverage_setup(editor_client)
    # Step 1's PRI is the Fixed Mode's, but its RF is outside it.
    resp = editor_client.post(seqs, json={"label": "Off RF", "kind": "dwell_switch", "steps": _steps(
        {"pri_us": 1000, "rf_mhz": 9500}, {"pri_us": 1000, "rf_mhz": 9600})})
    assert resp.status_code == 201, resp.text
    rows = editor_client.get(f"/emitters/{eid}/element-coverage").json()["elements"]
    row = next(r for r in rows if r["sequence"] and r["sequence"]["label"] == "Off RF")
    assert row["coverage"] == "not_covered"


def test_a_sequence_without_pri_cant_be_a_stagger(editor_client):
    eid, seqs, _ = _coverage_setup(editor_client)
    resp = editor_client.post(seqs, json={"label": "Hops", "kind": "stagger", "steps": _steps({"rf_mhz": 9000})})
    assert resp.status_code == 422
    hops = editor_client.post(seqs, json={"label": "Hops", "steps": _steps({"rf_mhz": 9000})}).json()
    assert hops["guessed_kind"] == "dwell_switch"
    assert editor_client.patch(f"{seqs}/{hops['id']}", json={"kind": "stagger"}).status_code == 422


def test_the_kind_is_saved_in_versions_and_reverted(editor_client):
    eid, seqs, seq = _coverage_setup(editor_client)
    editor_client.patch(f"{seqs}/{seq['id']}", json={"kind": "dwell_switch"})
    v1 = editor_client.post(f"/emitters/{eid}/versions", json={"change_summary": "v1"})
    assert v1.status_code == 201, v1.text
    editor_client.patch(f"{seqs}/{seq['id']}", json={"kind": "stagger"})
    resp = editor_client.post(f"/emitters/{eid}/versions/{v1.json()['version_number']}/revert")
    assert resp.status_code in (200, 201), resp.text
    [after] = [s for s in editor_client.get(seqs).json() if s["id"] == seq["id"]]
    assert after["kind"] == "dwell_switch"
