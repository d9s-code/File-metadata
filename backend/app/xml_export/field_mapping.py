"""PLACEHOLDER XML tag-name mapping, pending the real target XML Schema.

This is the single place internal field names are mapped to XML
element/attribute names. Once the real XSD is provided, swap the values
here (and add validation in serializer.py) — the tree-walking logic in
serializer.py does not need to change.

Every entry maps an internal field name to the XML element name that will
wrap its value. "_container"-suffixed keys name the wrapping element for a
list of children (e.g. <Platforms><Platform>...</Platform></Platforms>).
"""

MDF = {
    "root": "MissionDataFile",
    "id": "Id",
    "name": "Name",
    "description": "Description",
    "status": "Status",
    "platforms_container": "Platforms",
}

PLATFORM = {
    "root": "Platform",
    "id": "Id",
    "name": "Name",
    "description": "Description",
    "pinned_version": "PinnedVersion",
    "emitters_container": "Emitters",
}

EMITTER = {
    "root": "Emitter",
    "id": "Id",
    "name": "Name",
    "designation": "Designation",
    "description": "Description",
    "status": "Status",
    "pinned_version": "PinnedVersion",
    "ew_groups_container": "EwGroups",
}

EW_GROUP = {
    "root": "EwGroup",
    "id": "Id",
    "name": "Name",
    "scan_min": "ScanMin",
    "scan_max": "ScanMax",
    "threat_priority": "ThreatPriority",
    "modes_container": "Modes",
}

MODE = {
    "root": "Mode",
    "id": "Id",
    "name": "Name",
    "pri_type": "PriType",
    "notes": "Notes",
    "line": "ModeLine",
}

MODE_LINE = {
    "rf_min_mhz": "RfMin",
    "rf_max_mhz": "RfMax",
    "pw_min_us": "PwMin",
    "pw_max_us": "PwMax",
    "pri_min_us": "PriMin",
    "pri_max_us": "PriMax",
    "jitter_min_us": "JitterMin",
    "jitter_max_us": "JitterMax",
    "stagger_values_container": "StaggerValues",
    "stagger_value": "Value",
    "dsl_text": "DslText",
}
