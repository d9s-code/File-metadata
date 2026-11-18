"""A Fixed Mode's jitter has a ± delta like its RF, PRI and PW: optional,
widening the jitter range the sensor matches (never below 0 µs) — what the
PRS export writes and the ambiguity check compares — kept by versions and
Batch Edit, and refused on a PRI type with no jitter."""

from lxml import etree

from app.services.prs_export.serializer import _append_mode_element

LINE = {
    "rf_min_mhz": 2900, "rf_max_mhz": 3100, "pw_min_us": 0.5, "pw_max_us": 1.2,
    "pri_min_us": 800, "pri_max_us": 1200, "jitter_min_us": 1, "jitter_max_us": 4,
    "rf_delta": 0, "pw_delta": 0, "pri_delta": 0,
    "rf_range_matching": False, "pw_range_matching": False, "pri_range_matching": False,
}  # fmt: skip


def _ctx(client):
    emitter = client.post("/emitters", json={"name": "Jitter Delta Emitter"}).json()
    group = client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "G"}).json()
    source = client.post(f"/emitters/{emitter['id']}/sources", json={"name": "S", "source_date": "2026-01-01"}).json()
    return emitter, group, source


def _mode(client, group, source, name="Search", **line):
    resp = client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": name, "pri_type": "fixed", "line": {**LINE, **line}},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_the_jitter_range_is_widened_by_its_delta_never_below_zero(editor_client):
    _emitter, group, source = _ctx(editor_client)
    mode = _mode(editor_client, group, source, jitter_delta=1.5)
    line = mode["line"]
    assert line["jitter_delta"] == 1.5
    assert (line["engineered_jitter_min_us"], line["engineered_jitter_max_us"]) == (0, 5.5)
    # Without one, the range as typed — as before.
    plain = _mode(editor_client, group, source, name="Plain")["line"]
    assert plain["jitter_delta"] is None
    assert (plain["engineered_jitter_min_us"], plain["engineered_jitter_max_us"]) == (1, 4)


def test_only_a_fixed_pri_has_a_jitter_delta(editor_client):
    _emitter, group, source = _ctx(editor_client)
    stagger = {k: v for k, v in LINE.items() if not k.startswith(("pri_", "jitter_"))}
    resp = editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "S", "pri_type": "stagger", "line": {
            **stagger, "pri_range_matching": False, "pri_stagger_values_us": [100, 200], "frame_time_delta_us": 3, "jitter_delta": 1}},
    )  # fmt: skip
    assert resp.status_code == 422
    assert editor_client.post(
        f"/ew-groups/{group['id']}/modes",
        json={"source_id": source["id"], "name": "F", "pri_type": "fixed", "line": {**LINE, "jitter_delta": -1}},
    ).status_code == 422


def test_batch_edit_sets_it_on_fixed_modes_and_other_edits_keep_it(editor_client):
    emitter, group, source = _ctx(editor_client)
    a = _mode(editor_client, group, source, name="A")
    b = _mode(editor_client, group, source, name="B", jitter_delta=2)
    url = f"/emitters/{emitter['id']}/modes/batch-edit"
    # Another change: B's jitter delta stays.
    assert editor_client.post(url, json={"mode_ids": [a["id"], b["id"]], "fields": {"rf_delta": 1}}).status_code == 200
    deltas = {m["name"]: m["line"]["jitter_delta"] for m in editor_client.get(f"/emitters/{emitter['id']}/modes").json()}
    assert deltas == {"A": None, "B": 2}
    assert editor_client.post(url, json={"mode_ids": [a["id"], b["id"]], "fields": {"jitter_delta": 0.5}}).status_code == 200
    deltas = {m["name"]: m["line"]["jitter_delta"] for m in editor_client.get(f"/emitters/{emitter['id']}/modes").json()}
    assert deltas == {"A": 0.5, "B": 0.5}


def test_versions_keep_it(editor_client):
    emitter, group, source = _ctx(editor_client)
    _mode(editor_client, group, source, jitter_delta=0.25)
    version = editor_client.post(f"/emitters/{emitter['id']}/versions", json={"change_summary": "v1"}).json()
    detail = editor_client.get(f"/emitters/{emitter['id']}/versions/{version['version_number']}").json()
    [mode] = [m for g in detail["snapshot"]["ew_groups"] for m in g["modes"]]
    assert mode["line"]["jitter_delta"] == 0.25


def test_the_prs_export_writes_the_widened_jitter():
    def jitter(**line):
        parent = etree.Element("Modes")
        _append_mode_element(parent, {"name": "M", "pri_type": "fixed", "line": {**LINE, **line}}, scan_name="S")
        el = parent.find(".//PRI/Jitter")
        return el.get("Min"), el.get("Max")

    assert jitter() == ("1", "4")
    assert jitter(jitter_delta=1.5) == ("0", "5.5")
