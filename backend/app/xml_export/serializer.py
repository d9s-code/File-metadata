"""Serializes a committed MDF version's snapshot to the (placeholder-mapped)
target XML format. Walks Platform -> Emitter -> EW Group -> Mode -> mode
line. Deliberately excludes `sources` and `mode_elements` — those are an
authoring/organizational construct with no meaning to the recognizer, so
they never appear in the exported XML.
"""

from lxml import etree

from app.xml_export.field_mapping import EMITTER, EW_GROUP, MDF, MODE, MODE_LINE, PLATFORM


def _set_text(parent: etree._Element, tag: str, value) -> None:
    if value is None:
        return
    child = etree.SubElement(parent, tag)
    child.text = str(value)


def _build_mode_line_xml(parent: etree._Element, mode_el: etree._Element, line: dict | None) -> None:
    if line is None:
        return
    line_el = etree.SubElement(mode_el, MODE.get("line", "ModeLine"))
    for field in ("rf_min_mhz", "rf_max_mhz", "pw_min_us", "pw_max_us", "pri_min_us", "pri_max_us", "jitter_min_us", "jitter_max_us"):
        _set_text(line_el, MODE_LINE[field], line.get(field))

    stagger_values = line.get("pri_stagger_values_us")
    if stagger_values:
        container = etree.SubElement(line_el, MODE_LINE["stagger_values_container"])
        for v in stagger_values:
            _set_text(container, MODE_LINE["stagger_value"], v)

    _set_text(line_el, MODE_LINE["dsl_text"], line.get("dsl_text"))


def _build_mode_xml(parent: etree._Element, mode: dict) -> None:
    mode_el = etree.SubElement(parent, MODE["root"])
    _set_text(mode_el, MODE["id"], mode["id"])
    _set_text(mode_el, MODE["name"], mode["name"])
    _set_text(mode_el, MODE["pri_type"], mode["pri_type"])
    _set_text(mode_el, MODE["notes"], mode.get("notes"))
    _build_mode_line_xml(parent, mode_el, mode.get("line"))


def _build_ew_group_xml(parent: etree._Element, ew_group: dict) -> None:
    group_el = etree.SubElement(parent, EW_GROUP["root"])
    _set_text(group_el, EW_GROUP["id"], ew_group["id"])
    _set_text(group_el, EW_GROUP["name"], ew_group["name"])
    _set_text(group_el, EW_GROUP["scan_min"], ew_group.get("scan_min"))
    _set_text(group_el, EW_GROUP["scan_max"], ew_group.get("scan_max"))
    _set_text(group_el, EW_GROUP["threat_priority"], ew_group.get("threat_priority"))

    modes_el = etree.SubElement(group_el, EW_GROUP["modes_container"])
    for mode in ew_group["modes"]:
        _build_mode_xml(modes_el, mode)


def _build_emitter_xml(parent: etree._Element, emitter_snapshot: dict, emitter_version_number: int) -> None:
    # `sources` is intentionally not read here — it never reaches the XML output.
    emitter_el = etree.SubElement(parent, EMITTER["root"])
    _set_text(emitter_el, EMITTER["id"], emitter_snapshot["id"])
    _set_text(emitter_el, EMITTER["name"], emitter_snapshot["name"])
    _set_text(emitter_el, EMITTER["designation"], emitter_snapshot.get("designation"))
    _set_text(emitter_el, EMITTER["description"], emitter_snapshot.get("description"))
    _set_text(emitter_el, EMITTER["status"], emitter_snapshot.get("status"))
    _set_text(emitter_el, EMITTER["pinned_version"], emitter_version_number)

    groups_el = etree.SubElement(emitter_el, EMITTER["ew_groups_container"])
    for ew_group in emitter_snapshot["ew_groups"]:
        _build_ew_group_xml(groups_el, ew_group)


def _build_platform_xml(parent: etree._Element, platform_link: dict) -> None:
    platform_snapshot = platform_link["platform_snapshot"]
    platform_el = etree.SubElement(parent, PLATFORM["root"])
    _set_text(platform_el, PLATFORM["id"], platform_link["platform_id"])
    _set_text(platform_el, PLATFORM["name"], platform_link["platform_name"])
    _set_text(platform_el, PLATFORM["description"], platform_snapshot.get("description"))
    _set_text(platform_el, PLATFORM["pinned_version"], platform_link["platform_version_number"])

    emitters_el = etree.SubElement(platform_el, PLATFORM["emitters_container"])
    for emitter_link in platform_snapshot["links"]:
        _build_emitter_xml(emitters_el, emitter_link["emitter_snapshot"], emitter_link["emitter_version_number"])


def serialize_mdf_snapshot_to_xml(mdf_snapshot: dict, version_number: int) -> bytes:
    root = etree.Element(MDF["root"])
    _set_text(root, MDF["id"], mdf_snapshot["id"])
    _set_text(root, MDF["name"], mdf_snapshot["name"])
    _set_text(root, MDF["description"], mdf_snapshot.get("description"))
    _set_text(root, MDF["status"], mdf_snapshot.get("status"))
    root.set("version", str(version_number))

    platforms_el = etree.SubElement(root, MDF["platforms_container"])
    for platform_link in mdf_snapshot["links"]:
        _build_platform_xml(platforms_el, platform_link)

    return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="UTF-8")
