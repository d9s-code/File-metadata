"""The Platform confidence condition language: parsing, writing out,
evaluating, and "what it takes"."""

import pytest

from app.services.pcl_expr import Heard, PclSyntaxError, evaluate, parse, refs, to_text, ways

EMITTERS = {"sea search": "E1", "fire control": "E2", "nav": "E3", "sps-55": "E4"}
NAMES = {"E1": "Sea Search", "E2": "Fire Control", "E3": "Nav", "E4": "SPS-55"}
MODES = {"E2": ["Track 2", "Search"]}


def _resolve(name):
    eid = EMITTERS.get(name.lower())
    return (eid, None) if eid else (None, f"No Emitter named '{name}'")


def _resolve_mode(eid, mode):
    for m in MODES.get(eid, []):
        if m.lower() == mode.lower():
            return m, None
    return None, f"{NAMES[eid]} has no Mode '{mode}'"


def p(text):
    return parse(text, _resolve, _resolve_mode)


def heard(*items):
    emitters, modes = set(), set()
    for i in items:
        if "." in i:
            e, m = i.split(".")
            modes.add((e, m.lower()))
            emitters.add(e)
        else:
            emitters.add(i)
    return Heard(frozenset(emitters), frozenset(modes))


def test_parses_and_writes_out_with_current_names():
    ast = p('"Sea Search" and "fire control"."track 2" OR nav')
    assert ast == {
        "op": "or",
        "args": [
            {"op": "and", "args": [{"op": "emitter", "id": "E1"}, {"op": "mode", "id": "E2", "mode": "Track 2"}]},
            {"op": "emitter", "id": "E3"},
        ],
    }
    assert to_text(ast, NAMES.get) == '"Sea Search" AND "Fire Control"."Track 2" OR "Nav"'
    # Bare names with a dash; OR inside AND keeps its brackets.
    assert to_text(p("SPS-55 AND (Nav OR \"Sea Search\")"), NAMES.get) == '"SPS-55" AND ("Nav" OR "Sea Search")'


def test_n_of_and_not():
    ast = p('2 OF ("Sea Search", Nav, "Fire Control") AND NOT SPS-55')
    assert evaluate(ast, heard("E1", "E3")) is True
    assert evaluate(ast, heard("E1")) is False
    assert evaluate(ast, heard("E1", "E3", "E4")) is False
    assert to_text(ast, NAMES.get) == '2 OF ("Sea Search", "Nav", "Fire Control") AND NOT "SPS-55"'


def test_a_mode_is_heard_only_as_that_mode():
    ast = p('"Fire Control"."Track 2"')
    assert evaluate(ast, heard("E2.Track 2")) is True
    assert evaluate(ast, heard("E2.Search")) is False
    # An Emitter is heard when any of its Modes is.
    assert evaluate(p('"Fire Control"'), heard("E2.Search")) is True


@pytest.mark.parametrize(
    ("text", "message", "pos"),
    [
        ("", "Write a condition", 0),
        ('"Sea Search" AND', "Expected an Emitter's name", 16),
        ('"Unknown"', "No Emitter named 'Unknown'", 0),
        ('"Fire Control"."Burst"', "Fire Control has no Mode 'Burst'", 15),
        ('3 OF (Nav, SPS-55)', "3 OF needs between 1 and 2", 0),
        ('(Nav OR SPS-55', "Expected ')'", 14),
        ('"Sea Search', "isn't closed", 0),
        ("Nav Nav", "Expected AND, OR or the end", 4),
    ],
)
def test_errors_say_what_and_where(text, message, pos):
    with pytest.raises(PclSyntaxError) as err:
        p(text)
    assert message in str(err.value)
    assert err.value.position == pos


def test_refs_once_each():
    assert refs(p("Nav AND (Nav OR \"Fire Control\".\"Search\")")) == [
        {"op": "emitter", "id": "E3"},
        {"op": "mode", "id": "E2", "mode": "Search"},
    ]


def test_what_it_takes():
    terms, cut = ways(p('2 OF ("Sea Search", Nav, "Fire Control") AND NOT SPS-55'))
    assert not cut
    needs = sorted(sorted(a[1] for a in t[0]) for t in terms)
    assert needs == [["E1", "E2"], ["E1", "E3"], ["E2", "E3"]]
    assert all(t[1] == frozenset({("e", "E4")}) for t in terms)
    # A term that's a superset of another is dropped.
    terms, _ = ways(p("Nav OR (Nav AND SPS-55)"))
    assert [sorted(a[1] for a in t[0]) for t in terms] == [["E3"]]
