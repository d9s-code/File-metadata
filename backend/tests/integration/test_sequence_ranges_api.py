import json

import pytest

from app.services.json_import.transformer import transform_json_to_payload
from tests.integration.test_elements_cartesian_api import _elements_url, emitter_ctx  # noqa: F401


def _json_file(steps):
    return [
        {
            "file": "seq.xml",
            "notation": "S-1",
            "parametric_sets": [
                {
                    "set_id": "SET-SEQ",
                    "date_last_updated": "10-06-2015 17:19:28 GMT",
                    "groups": [{"type": "sequence", "name": "Hop", "steps": steps}],
                }
            ],
        }
    ]


MIXED_STEPS = [
    {"step-num": "1", "rf-value": {"min": "9000", "max": "9100"}, "pri-value": {"min": "800", "max": "820"}},
    {"step-num": "2", "rf-value": {"min": "9200", "max": "9300"}, "pri-value": {"min": "900", "max": "900"}},
]


def _steps(payload):
    return [s.model_dump(exclude_none=True) for s in payload.parametric_sets[0].sequences[0].steps]


def test_mixed_parameter_sequence_keeps_min_and_max():
    steps = _steps(transform_json_to_payload(_json_file(MIXED_STEPS)))
    assert steps == [
        {"order": 1, "rf_min_mhz": 9000, "rf_max_mhz": 9100, "pri_min_us": 800, "pri_max_us": 820},
        # A range with min == max stays a single value.
        {"order": 2, "rf_min_mhz": 9200, "rf_max_mhz": 9300, "pri_us": 900},
    ]


def test_pw_given_as_pulse_duration_counts_as_a_parameter_type():
    steps = _steps(
        transform_json_to_payload(
            _json_file([{"step-num": "1", "pd-value": {"min": "1", "max": "2"}, "pri-value": {"min": "800", "max": "810"}}])
        )
    )
    assert steps == [{"order": 1, "pw_min_us": 1, "pw_max_us": 2, "pri_min_us": 800, "pri_max_us": 810}]


def test_single_parameter_sequence_still_takes_one_value_per_step():
    steps = _steps(
        transform_json_to_payload(
            _json_file(
                [
                    {"step-num": "1", "pri-value": {"min": "800", "max": "820"}},
                    {"step-num": "2", "pri-value": {"min": "900", "max": "900"}},
                ]
            )
        )
    )
    assert steps == [{"order": 1, "pri_us": 810}, {"order": 2, "pri_us": 900}]


@pytest.mark.parametrize(
    "step",
    [
        {"order": 0, "rf_min_mhz": 9000},
        {"order": 0, "rf_min_mhz": 9100, "rf_max_mhz": 9000},
        {"order": 0, "rf_mhz": 9050, "rf_min_mhz": 9000, "rf_max_mhz": 9100},
    ],
)
def test_malformed_step_ranges_are_rejected(editor_client, emitter_ctx, step):  # noqa: F811
    url = f"/emitters/{emitter_ctx['emitter']['id']}/sources/{emitter_ctx['source']['id']}/parameter-sequences"
    assert editor_client.post(url, json={"label": "Bad", "steps": [step]}).status_code == 422


def test_json_import_stores_ranges_and_cartesian_uses_them(editor_client, emitter_ctx):  # noqa: F811
    eid = emitter_ctx["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{eid}/imports/json-import",
        files={"file": ("seq.json", json.dumps(_json_file(MIXED_STEPS)).encode(), "application/json")},
        data={"source_date": "2026-03-01"},
    )
    assert resp.status_code == 201, resp.text
    source = next(s for s in editor_client.get(f"/emitters/{eid}/sources").json() if s["name"] == "SET-SEQ")
    [seq] = editor_client.get(f"/emitters/{eid}/sources/{source['id']}/parameter-sequences").json()
    first = seq["steps"][0]
    assert (first["rf_min_mhz"], first["rf_max_mhz"], first["pri_min_us"], first["pri_max_us"]) == (9000, 9100, 800, 820)
    assert first["rf_mhz"] is None and first["pri_us"] is None

    ctx = {**emitter_ctx, "source": source}
    resp = editor_client.post(
        f"{_elements_url(ctx)}/cartesian-product",
        json={
            "ew_group_id": emitter_ctx["ew_group"]["id"],
            "rf_element_ids": [],
            "pw_element_ids": [],
            "pri_element_ids": [],
            "sequence_steps": [{"sequence_id": seq["id"], "order": 1}, {"sequence_id": seq["id"], "order": 2}],
            "name_prefix": "Hop",
        },
    )
    assert resp.status_code == 200, resp.text
    lines = sorted(
        (m["line"] for m in editor_client.get(f"/ew-groups/{emitter_ctx['ew_group']['id']}/modes").json()),
        key=lambda line: line["rf_min_mhz"],
    )
    assert [(l["rf_min_mhz"], l["rf_max_mhz"], l["pri_min_us"], l["pri_max_us"]) for l in lines] == [
        (9000, 9100, 800, 820),
        (9200, 9300, 900, 900),
    ]


# --- Step numbering ----------------------------------------------------------


def _pri(i):
    return {"min": str(800 + i), "max": str(800 + i)}


def test_long_sequence_keeps_the_files_step_numbers():
    steps = _steps(transform_json_to_payload(_json_file([{"step-num": str(i), "pri-value": _pri(i)} for i in range(1, 61)])))
    assert [s["order"] for s in steps] == list(range(1, 61))
    assert steps[-1]["pri_us"] == 860


def test_rows_sharing_a_step_number_are_merged_into_one_step():
    rows = [{"step-num": str(i), "pri-value": {"min": "800", "max": "810"}} for i in (1, 2)] + [
        {"step-num": str(i), "rf-value": {"min": "9000", "max": "9100"}} for i in (1, 2)
    ]
    assert _steps(transform_json_to_payload(_json_file(rows))) == [
        {"order": n, "rf_min_mhz": 9000, "rf_max_mhz": 9100, "pri_min_us": 800, "pri_max_us": 810} for n in (1, 2)
    ]


@pytest.mark.parametrize(
    "numbers",
    [
        [None, None, None, None],  # no step-num at all
        ["1", "2", "1", "2"],  # numbering restarts
        ["1", None, "3", "4"],  # some missing
        ["1", "2.5", "3", "4"],  # not a whole number
    ],
)
def test_steps_fall_back_to_file_order_when_numbers_dont_identify_them(numbers):
    rows = [{**({"step-num": n} if n is not None else {}), "pri-value": _pri(i)} for i, n in enumerate(numbers)]
    steps = _steps(transform_json_to_payload(_json_file(rows)))
    assert [(s["order"], s["pri_us"]) for s in steps] == [(1, 800), (2, 801), (3, 802), (4, 803)]


def test_whole_number_step_numbers_written_as_decimals_are_accepted():
    steps = _steps(transform_json_to_payload(_json_file([{"step-num": "7.0", "pri-value": _pri(0)}])))
    assert steps == [{"order": 7, "pri_us": 800}]


def test_rows_without_any_parameter_are_skipped():
    rows = [{"step-num": "1", "pri-value": _pri(0)}, {"step-num": "2"}, {"step-num": "3", "pri-value": _pri(3)}]
    assert [s["order"] for s in _steps(transform_json_to_payload(_json_file(rows)))] == [1, 3]


def test_repeated_step_numbers_name_the_sequence_and_the_numbers(editor_client, emitter_ctx):  # noqa: F811
    url = f"/emitters/{emitter_ctx['emitter']['id']}/sources/{emitter_ctx['source']['id']}/parameter-sequences"
    steps = [{"order": 1, "pri_us": 800}, {"order": 1, "pri_us": 810}, {"order": 4, "pri_us": 820}, {"order": 4, "pri_us": 830}]
    resp = editor_client.post(url, json={"label": "Hop", "steps": steps})
    assert resp.status_code == 422
    assert "Sequence 'Hop' has more than one step numbered 1, 4" in resp.text


def test_json_import_of_a_60_step_sequence_without_step_numbers(editor_client, emitter_ctx):  # noqa: F811
    eid = emitter_ctx["emitter"]["id"]
    resp = editor_client.post(
        f"/emitters/{eid}/imports/json-import",
        files={"file": ("big.json", json.dumps(_json_file([{"pri-value": _pri(i)} for i in range(60)])).encode(), "application/json")},
        data={"source_date": "2026-03-01"},
    )
    assert resp.status_code == 201, resp.text
    source = next(s for s in editor_client.get(f"/emitters/{eid}/sources").json() if s["name"] == "SET-SEQ")
    [seq] = editor_client.get(f"/emitters/{eid}/sources/{source['id']}/parameter-sequences").json()
    assert [s["order"] for s in seq["steps"]] == list(range(1, 61))
