from lxml import etree

from app.xml_export.serializer import serialize_mdf_snapshot_to_xml

MODE_LINE = {
    "rf_min_mhz": 2900,
    "rf_max_mhz": 3100,
    "pw_min_us": 0.5,
    "pw_max_us": 1.2,
    "pri_min_us": 800,
    "pri_max_us": 1200,
    "jitter_min_us": 5,
    "jitter_max_us": 15,
    "pri_stagger_values_us": None,
    "type_data": None,
    "dsl_text": "RF 2900-3100 PRI FIXED 800-1200 JITTER 5-15 PW 0.5-1.2",
}

EMITTER_SNAPSHOT = {
    "id": "e1",
    "name": "AN/APG-99",
    "designation": "SPEAR EYE",
    "description": "Test emitter",
    "status": "validated",
    "ew_groups": [
        {
            "id": "g1",
            "name": "Track Group",
            "scan_min": 1.5,
            "scan_max": 3.0,
            "threat_priority": 8,
            "sort_order": 0,
            "modes": [{"id": "m1", "name": "Mode 1", "pri_type": "fixed", "notes": None, "sort_order": 0, "source_id": "s1", "line": MODE_LINE}],
        }
    ],
    "sources": [
        {
            "id": "s1",
            "name": "ELINT Report 4521",
            "description": "Collection Alpha",
            "source_date": "2025-03-14",
            "elements": [{"id": "el1", "element_type": "rf", "value_min": 2900, "value_max": 3100, "stagger_values": None, "jitter_min": None, "jitter_max": None, "label": None, "sort_order": 0}],
        }
    ],
}

MDF_SNAPSHOT = {
    "id": "mdf1",
    "name": "MDF Alpha",
    "description": "Test MDF",
    "status": "draft",
    "links": [
        {
            "platform_id": "p1",
            "platform_name": "USS Test Ship",
            "platform_version_id": "pv1",
            "platform_version_number": 3,
            "platform_snapshot": {
                "id": "p1",
                "name": "USS Test Ship",
                "description": "A test platform",
                "links": [
                    {
                        "emitter_id": "e1",
                        "emitter_name": "AN/APG-99",
                        "emitter_version_id": "ev1",
                        "emitter_version_number": 5,
                        "emitter_snapshot": EMITTER_SNAPSHOT,
                    }
                ],
            },
        }
    ],
}


def _parse(xml_bytes: bytes) -> etree._Element:
    return etree.fromstring(xml_bytes)


def test_export_is_well_formed_xml():
    xml_bytes = serialize_mdf_snapshot_to_xml(MDF_SNAPSHOT, version_number=2)
    root = _parse(xml_bytes)
    assert root.tag == "MissionDataFile"
    assert root.get("version") == "2"


def test_export_walks_full_hierarchy():
    root = _parse(serialize_mdf_snapshot_to_xml(MDF_SNAPSHOT, version_number=1))

    platform = root.find("Platforms/Platform")
    assert platform.find("Name").text == "USS Test Ship"
    assert platform.find("PinnedVersion").text == "3"

    emitter = platform.find("Emitters/Emitter")
    assert emitter.find("Name").text == "AN/APG-99"
    assert emitter.find("Designation").text == "SPEAR EYE"
    assert emitter.find("Status").text == "validated"
    assert emitter.find("PinnedVersion").text == "5"

    ew_group = emitter.find("EwGroups/EwGroup")
    assert ew_group.find("Name").text == "Track Group"
    assert ew_group.find("ThreatPriority").text == "8"

    mode = ew_group.find("Modes/Mode")
    assert mode.find("Name").text == "Mode 1"
    assert mode.find("PriType").text == "fixed"

    line = mode.find("ModeLine")
    assert line.find("RfMin").text == "2900"
    assert line.find("JitterMax").text == "15"
    assert line.find("DslText").text == MODE_LINE["dsl_text"]


def test_export_renders_stagger_sequence():
    snapshot_with_stagger = {
        **MDF_SNAPSHOT,
        "links": [
            {
                **MDF_SNAPSHOT["links"][0],
                "platform_snapshot": {
                    **MDF_SNAPSHOT["links"][0]["platform_snapshot"],
                    "links": [
                        {
                            "emitter_id": "e1",
                            "emitter_name": "AN/APG-99",
                            "emitter_version_id": "ev1",
                            "emitter_version_number": 5,
                            "emitter_snapshot": {
                                **EMITTER_SNAPSHOT,
                                "ew_groups": [
                                    {
                                        **EMITTER_SNAPSHOT["ew_groups"][0],
                                        "modes": [
                                            {
                                                "id": "m2",
                                                "name": "Mode Stagger",
                                                "pri_type": "stagger",
                                                "notes": None,
                                                "sort_order": 0,
                                                "source_id": "s1",
                                                "line": {**MODE_LINE, "pri_min_us": None, "pri_max_us": None, "pri_stagger_values_us": [800, 850, 900]},
                                            }
                                        ],
                                    }
                                ],
                            },
                        }
                    ],
                },
            }
        ],
    }
    root = _parse(serialize_mdf_snapshot_to_xml(snapshot_with_stagger, version_number=1))
    values = root.findall(".//StaggerValues/Value")
    assert [v.text for v in values] == ["800", "850", "900"]


def test_export_excludes_sources_and_mode_elements():
    xml_bytes = serialize_mdf_snapshot_to_xml(MDF_SNAPSHOT, version_number=1)
    text = xml_bytes.decode("utf-8")
    assert "ELINT Report 4521" not in text
    assert "Collection Alpha" not in text
    assert "Sources" not in text
    assert "ModeElements" not in text
