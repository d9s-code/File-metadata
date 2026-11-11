"""Platform confidence rules (experimental): conditions per level, checked
against an MDF (too loose, only through look-alikes, too strict, can't be
met), suggested from what's unique, and "what if" a set of things is heard.

The fleet (see test_platform_uniqueness_api): the Frigate has Fire Control
(only on it; Track and Burst unique, Search like the Corvette's Nav Radar ·
Nav), Shared A (also on the Corvette) and Shared B (also on the Tug)."""

from tests.integration.test_platform_uniqueness_api import _setup


def _ids(client, mdf):
    body = client.get(f"/pcl/mdfs/{mdf['id']}/uniqueness").json()
    return {p["platform_name"]: p["platform_id"] for p in body["platforms"]}


def _platform(client, mdf, name):
    body = client.get(f"/pcl/mdfs/{mdf['id']}/rules").json()
    return next(p for p in body["platforms"] if p["platform_name"] == name)


def _add(client, platform_id, level, text, **extra):
    resp = client.post(f"/pcl/platforms/{platform_id}/rules", json={"level": level, "text": text, **extra})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_suggestions_come_from_what_is_unique(editor_client):
    mdf = _setup(editor_client)
    frigate = _platform(editor_client, mdf, "Frigate")
    assert frigate["rules"] == []
    by_level = {}
    for s in frigate["suggestions"]:
        by_level.setdefault(s["level"], []).append(s["text"])
    assert by_level[3] == ['"Fire Control"."Burst" OR "Fire Control"."Track"']
    assert by_level[2] == ['"Fire Control"', '"Shared A" AND "Shared B"']
    assert by_level[1] == ['"Fire Control" OR "Shared A" OR "Shared B"']
    # The Tug has nothing unique: only "any of its Emitters".
    assert [s["level"] for s in _platform(editor_client, mdf, "Tug")["suggestions"]] == [1]

    # An added suggestion isn't suggested again.
    _add(editor_client, frigate["platform_id"], 2, '"Fire Control"')
    texts = [s["text"] for s in _platform(editor_client, mdf, "Frigate")["suggestions"]]
    assert '"Fire Control"' not in texts


def test_checks_say_when_a_rule_doesnt_tell_platforms_apart(editor_client):
    mdf = _setup(editor_client)
    ids = _ids(editor_client, mdf)
    _add(editor_client, ids["Frigate"], 3, '"Fire Control"."Track"')
    _add(editor_client, ids["Frigate"], 2, '"Shared A"')
    _add(editor_client, ids["Frigate"], 2, '"Fire Control"."Search"')
    _add(editor_client, ids["Frigate"], 1, '"Nav Radar"')
    _add(editor_client, ids["Frigate"], 2, '"Shared A" AND "Shared B" AND "Fire Control" AND "Fire Control"."Track"')
    _add(editor_client, ids["Frigate"], 2, '"Shared A" AND "Shared B" AND "Fire Control"."Track" AND "Fire Control"."Burst"')
    rules = {r["text"]: r for r in _platform(editor_client, mdf, "Frigate")["rules"]}
    # Highest level first.
    assert next(iter(rules)) == '"Fire Control"."Track"'

    track = rules['"Fire Control"."Track"']["check"]
    assert track["warnings"] == [] and track["own_ok"] is True
    ref = track["refs"][0]
    assert (ref["kind"], ref["unique"], ref["mode_unique_set"], ref["mode_unique_params"]) == ("mode", True, True, ["rf", "scan"])

    shared = rules['"Shared A"']["check"]
    assert shared["also_true_for"] == ["Corvette"]
    assert shared["refs"][0]["shared_with"] == ["Corvette"]

    # Search is only on the Frigate, but the Corvette's Nav can be taken for it.
    search = rules['"Fire Control"."Search"']["check"]
    assert search["also_true_for"] == [] and search["could_be_true_for"] == ["Corvette"]

    nav = rules['"Nav Radar"']["check"]
    assert nav["own_ok"] is False
    assert nav["refs"][0]["on_platform"] is False and nav["refs"][0]["elsewhere"] == ["Corvette"]
    assert "Hearing everything this Platform has doesn't meet it" in nav["warnings"]

    # Hearing a Mode is hearing its Emitter: three things, not four.
    three = rules['"Shared A" AND "Shared B" AND "Fire Control" AND "Fire Control"."Track"']["check"]
    assert three["fewest_needed"] == 3 and not any("too strict" in w for w in three["warnings"])
    assert sorted(three["ways"][0]["needs"]) == ["Fire Control · Track", "Shared A", "Shared B"]
    strict = rules['"Shared A" AND "Shared B" AND "Fire Control"."Track" AND "Fire Control"."Burst"']["check"]
    assert strict["fewest_needed"] == 4
    assert any("likely too strict" in w for w in strict["warnings"])


def test_what_it_takes_lists_the_smallest_ways(editor_client):
    mdf = _setup(editor_client)
    ids = _ids(editor_client, mdf)
    resp = editor_client.post(
        "/pcl/check",
        json={"platform_id": ids["Frigate"], "mdf_id": mdf["id"], "text": '2 of ("Shared A", "Shared B", "Fire Control") and not "Nav Radar"'},
    )
    body = resp.json()
    assert body["ok"] is True
    assert body["text"] == '2 OF ("Shared A", "Shared B", "Fire Control") AND NOT "Nav Radar"'
    assert len(body["check"]["ways"]) == 3
    assert all(w["without"] == ["Nav Radar"] for w in body["check"]["ways"])
    assert body["check"]["fewest_needed"] == 2


def test_a_condition_that_doesnt_read_says_where(editor_client):
    mdf = _setup(editor_client)
    ids = _ids(editor_client, mdf)
    resp = editor_client.post("/pcl/check", json={"platform_id": ids["Frigate"], "text": '"Shared A" AND "Nope"'})
    assert resp.json() == {"ok": False, "message": "No Emitter named 'Nope'", "position": 15}
    bad = editor_client.post(f"/pcl/platforms/{ids['Frigate']}/rules", json={"level": 2, "text": '"Shared A" AND'})
    assert bad.status_code == 422
    assert bad.json()["detail"]["position"] == 14


def test_edit_delete_audit_and_renames(editor_client):
    mdf = _setup(editor_client)
    ids = _ids(editor_client, mdf)
    rule = _add(editor_client, ids["Frigate"], 2, '"Shared A" and "Shared B"', note="Pair")
    assert rule["text"] == '"Shared A" AND "Shared B"' and rule["note"] == "Pair"

    resp = editor_client.patch(f"/pcl/rules/{rule['id']}", json={"level": 3})
    assert resp.status_code == 200 and resp.json()["level"] == 3

    # A renamed Emitter: the rule reads with its new name.
    shared_a = next(e for p in editor_client.get(f"/pcl/mdfs/{mdf['id']}/uniqueness").json()["platforms"] for e in p["emitters"] if e["emitter_name"] == "Shared A")
    editor_client.patch(f"/emitters/{shared_a['emitter_id']}", json={"name": "Shared Alpha"})
    [after] = editor_client.get(f"/pcl/platforms/{ids['Frigate']}/rules").json()
    assert after["text"] == '"Shared Alpha" AND "Shared B"'

    assert editor_client.delete(f"/pcl/rules/{rule['id']}").status_code == 204
    assert editor_client.get(f"/pcl/platforms/{ids['Frigate']}/rules").json() == []
    summaries = [a["summary"] for a in editor_client.get("/audit-log").json()["items"]]
    assert any(s.startswith("Added a confidence rule to Platform 'Frigate': PCL 2 when") for s in summaries)
    assert any(s.startswith("Changed a confidence rule of Platform 'Frigate': PCL 3") for s in summaries)
    assert any(s.startswith("Removed a confidence rule of Platform 'Frigate'") for s in summaries)


def test_what_if_points_to_the_platforms(editor_client):
    mdf = _setup(editor_client)
    ids = _ids(editor_client, mdf)
    _add(editor_client, ids["Frigate"], 3, '"Fire Control"."Track"')
    _add(editor_client, ids["Frigate"], 2, '"Shared A" AND "Shared B"')
    _add(editor_client, ids["Frigate"], 1, '"Shared A" OR "Shared B" OR "Fire Control"')
    _add(editor_client, ids["Corvette"], 2, '"Nav Radar"')
    _add(editor_client, ids["Corvette"], 1, '"Shared A"')
    _add(editor_client, ids["Tug"], 1, '"Shared B"')
    emitters = {e["emitter_name"]: e["emitter_id"] for p in editor_client.get(f"/pcl/mdfs/{mdf['id']}/uniqueness").json()["platforms"] for e in p["emitters"]}

    def levels(**heard):
        body = editor_client.post(f"/pcl/mdfs/{mdf['id']}/what-if", json=heard).json()
        return {p["platform_name"]: p["level"] for p in body["platforms"]}

    assert levels(emitter_ids=[emitters["Shared A"], emitters["Shared B"]]) == {"Frigate": 2, "Corvette": 1, "Tug": 1}
    assert levels(modes=[{"emitter_id": emitters["Fire Control"], "mode": "track"}]) == {"Frigate": 3, "Corvette": 0, "Tug": 0}
    assert levels(emitter_ids=[emitters["Nav Radar"]]) == {"Corvette": 2, "Frigate": 0, "Tug": 0}


def test_viewers_read_but_dont_write(viewer_client, editor_client):
    mdf = _setup(editor_client)
    ids = _ids(editor_client, mdf)
    assert viewer_client.get(f"/pcl/mdfs/{mdf['id']}/rules").status_code == 200
    assert viewer_client.post(f"/pcl/platforms/{ids['Frigate']}/rules", json={"level": 1, "text": '"Shared A"'}).status_code == 403
