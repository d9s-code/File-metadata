"""All Sources: Modes generated from the merged Elements of every Source of
an Emitter, each Mode given the Sources its Elements were found in."""

import uuid

import pytest

from app.core.enums import SourceStatus
from app.models.source import Source


@pytest.fixture()
def three_sources(editor_client):
    emitter = editor_client.post("/emitters", json={"name": "All Sources Emitter"}).json()
    group = editor_client.post(f"/emitters/{emitter['id']}/ew-groups", json={"name": "Track"}).json()
    sources = {
        name: editor_client.post(
            f"/emitters/{emitter['id']}/sources", json={"name": name, "source_date": "2026-01-01"}
        ).json()
        for name in ("Alpha", "Bravo", "Charlie")
    }
    return emitter, group, sources


def _add(client, emitter, source, **element):
    return client.post(f"/emitters/{emitter['id']}/sources/{source['id']}/elements", json=element).json()


def _product(client, emitter, **body):
    return client.post(f"/emitters/{emitter['id']}/sources/all-sources/cartesian-product", json=body)


def test_each_mode_gets_the_sources_its_elements_came_from(editor_client, three_sources):
    emitter, group, s = three_sources
    # The same RF in Alpha and Bravo (with different margins): one Element.
    rf_a = _add(editor_client, emitter, s["Alpha"], element_type="rf", value_min=9000, value_max=9000, delta=2)
    _add(editor_client, emitter, s["Bravo"], element_type="rf", value_min=9000, value_max=9000, delta=5)
    rf_c = _add(editor_client, emitter, s["Charlie"], element_type="rf", value_min=9500, value_max=9500)
    pri_b = _add(
        editor_client, emitter, s["Bravo"], element_type="pri", value_min=800, value_max=800, jitter_min=0, jitter_max=1
    )
    pw_a = _add(editor_client, emitter, s["Alpha"], element_type="pw", value_min=1, value_max=1)

    resp = _product(
        editor_client,
        emitter,
        ew_group_id=group["id"],
        rf_element_ids=[rf_a["id"], rf_c["id"]],
        pri_element_ids=[pri_b["id"]],
        pw_element_ids=[pw_a["id"]],
        name_prefix="All",
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 2

    modes = {m["line"]["rf_min_mhz"]: m for m in editor_client.get(f"/ew-groups/{group['id']}/modes").json()}
    names = {v["id"]: k for k, v in s.items()}
    # RF 9000 (Alpha, Bravo) × PRI (Bravo) × PW (Alpha): Alpha and Bravo,
    # Bravo first — it holds two of the three, as does Alpha; by name then.
    first = modes[9000]
    assert [names[i] for i in first["source_ids"]] == ["Alpha", "Bravo"]
    assert first["line"]["rf_delta"] == 5  # the widest margin its Sources give
    # RF 9500 (Charlie) × PRI (Bravo) × PW (Alpha): all three.
    assert sorted(names[i] for i in modes[9500]["source_ids"]) == ["Alpha", "Bravo", "Charlie"]


def test_rejected_sources_only_when_nothing_else(editor_client, db_session, three_sources):
    emitter, group, s = three_sources
    rf = _add(editor_client, emitter, s["Alpha"], element_type="rf", value_min=100, value_max=100)
    _add(editor_client, emitter, s["Charlie"], element_type="rf", value_min=100, value_max=100)
    pri = _add(
        editor_client, emitter, s["Charlie"], element_type="pri", value_min=5, value_max=5, jitter_min=0, jitter_max=0
    )
    db_session.query(Source).filter(Source.id == uuid.UUID(s["Charlie"]["id"])).update(
        {"status": SourceStatus.rejected}
    )
    db_session.commit()
    resp = _product(
        editor_client, emitter, ew_group_id=group["id"], rf_element_ids=[rf["id"]], pri_element_ids=[pri["id"]],
        pw_element_ids=[], name_prefix="R",
    )
    assert resp.status_code == 200, resp.text
    mode = editor_client.get(f"/ew-groups/{group['id']}/modes").json()[0]
    assert mode["source_ids"] == [s["Alpha"]["id"]]


def test_refuses_elements_of_another_emitter_and_sequence_steps(editor_client, three_sources):
    emitter, group, s = three_sources
    other = editor_client.post("/emitters", json={"name": "Elsewhere"}).json()
    elsewhere = editor_client.post(
        f"/emitters/{other['id']}/sources", json={"name": "X", "source_date": "2026-01-01"}
    ).json()
    pri = _add(editor_client, other, elsewhere, element_type="pri", value_min=5, value_max=5, jitter_min=0, jitter_max=0)
    resp = _product(
        editor_client, emitter, ew_group_id=group["id"], rf_element_ids=[], pri_element_ids=[pri["id"]],
        pw_element_ids=[], name_prefix="X",
    )
    assert resp.status_code == 422
    resp = _product(
        editor_client, emitter, ew_group_id=group["id"], rf_element_ids=[], pri_element_ids=[], pw_element_ids=[],
        sequence_steps=[{"sequence_id": elsewhere["id"], "order": 0}], name_prefix="X",
    )
    assert resp.status_code == 422
