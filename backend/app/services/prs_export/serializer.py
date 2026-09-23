"""Builds PRS-format XML element trees from committed version snapshots
(never live ORM data — see packager.py, which is what actually loads the
snapshot dict this module consumes). Tag names, element order, and the
namespace URI here are taken directly from real sample files provided by
the target system (Profile_format/ — Example MDF.xml, PRS_FORMAT_EMITTER.xml,
default_unknown_platform.xml), not guessed. See prs_export_notes.md in this
package for exactly which fields are real vs. placeholder.
"""

import re

from lxml import etree

from app.services.delta import apply_delta
from app.services.frametime_service import compute_frametime_us
from app.services.snapshots import rejected_source_ids

PRS_NAMESPACE = "urn:com:bae:prs:pfm:library"

# Fields the app has no data source for at all — the real sample files show
# these as fixed/repeated values too (never varying per-mode or per-platform
# in the examples given), so a shared placeholder constant is a defensible
# stand-in until/unless the app grows real fields for them.
_PLACEHOLDER_LETHAL_CEILING = 0
_PLACEHOLDER_LETHAL_POWER = -50
_PLACEHOLDER_MIN_ERP = 80
_PLACEHOLDER_MAX_ERP = 80
_PLACEHOLDER_CONFIRMATION_QUALITY = 100
_PLACEHOLDER_CONFIRMATION_QUANTITY = 2
_PLACEHOLDER_HOSTILITY = "UNKNOWN"
_PLACEHOLDER_BASE = "UNKNOWN"

_PRI_CLASS_MAP = {"fixed": "Simple", "stagger": "Stagger", "xlet": "Xlet", "cw": "CW"}


def _sanitize(value: str | None) -> str:
    return (value or "").replace(" ", "_")


# Characters invalid in a Windows filename, plus zip's own "/" separator —
# real-world emitter designations often contain a forward slash (e.g.
# "AN/APG-99"), which _sanitize() above leaves untouched. Left unsanitized,
# that slash silently becomes an unintended nested directory in the export
# zip and a broken path in the referencing XML. This is only for values used
# as a filename/path segment, not for XML attribute/text content in general
# (where a literal "/" is harmless).
_FILENAME_UNSAFE_RE = re.compile(r'[\\/:*?"<>|\s]+')


def sanitize_filename(value: str | None) -> str:
    return _FILENAME_UNSAFE_RE.sub("_", value or "")


def _bool_attr(value: bool | None) -> str:
    return "true" if value else "false"


def _num_attr(value: float | int | None, default: float | int = 0) -> str:
    v = value if value is not None else default
    return str(int(v)) if float(v).is_integer() else str(v)


def build_emitter_element(emitter_snapshot: dict) -> etree._Element:
    root = etree.Element("Emitter", Name=_sanitize(emitter_snapshot["name"]))

    elnot = etree.SubElement(root, "ELNOT")
    elnot.text = _sanitize(emitter_snapshot.get("designation") or emitter_snapshot.get("description"))

    etree.SubElement(root, "OwnShip", Flag="false")
    etree.SubElement(root, "LethalCeiling", Value=_num_attr(_PLACEHOLDER_LETHAL_CEILING), Units="feet")

    ew_groups = emitter_snapshot.get("ew_groups", [])

    # One EWParameters set + one Scan per EW Group, linked 1:1 by SetId —
    # matches the real sample's shape exactly (each Scan carries one
    # EWParametersRef, never shared across groups).
    for set_id, group in enumerate(ew_groups, start=1):
        ew_params_el = etree.SubElement(root, "EWParameters", SetId=str(set_id))
        etree.SubElement(ew_params_el, "ThreatPriority", Value=_num_attr(group.get("threat_priority")))
        etree.SubElement(ew_params_el, "LethalPower", Value=_num_attr(_PLACEHOLDER_LETHAL_POWER), Units="dBm")
        etree.SubElement(ew_params_el, "MinERP", Value=_num_attr(_PLACEHOLDER_MIN_ERP), Units="dBm")
        etree.SubElement(ew_params_el, "MaxERP", Value=_num_attr(_PLACEHOLDER_MAX_ERP), Units="dBm")
        etree.SubElement(ew_params_el, "ModeFlags")
        # Real field, not a placeholder — see EwGroup.ageout / FEATURES.md.
        etree.SubElement(ew_params_el, "Ageout", Value=_num_attr(group.get("ageout")), Units="s")

    for set_id, group in enumerate(ew_groups, start=1):
        scan_el = etree.SubElement(root, "Scan", Name=_sanitize(group["name"]))
        # EW Group has no "scan class" concept in this app — placeholder,
        # matching the real sample's own literal "Undetermined" value.
        etree.SubElement(scan_el, "Class").text = "Undetermined"
        etree.SubElement(
            scan_el, "Period", Min=_num_attr(group.get("scan_min")), Max=_num_attr(group.get("scan_max")), Units="s"
        )
        etree.SubElement(scan_el, "EWParametersRef", SetId=str(set_id))

    etree.SubElement(root, "Intrapulse", Name="default", Modulation="Unknown")

    rejected = rejected_source_ids(emitter_snapshot)
    for group in ew_groups:
        for mode in group.get("modes", []):
            if mode["source_id"] not in rejected:
                _append_mode_element(root, mode, scan_name=group["name"])

    etree.SubElement(root, "TacticGroup").text = "None"
    return root


def _append_mode_element(parent: etree._Element, mode: dict, *, scan_name: str) -> None:
    line = mode.get("line") or {}
    mode_el = etree.SubElement(parent, "Mode", Name=_sanitize(mode["name"]))

    etree.SubElement(
        mode_el,
        "RangeMatch",
        PRI=_bool_attr(line.get("pri_range_matching")),
        PulseWidth=_bool_attr(line.get("pw_range_matching")),
        Frequency=_bool_attr(line.get("rf_range_matching")),
    )
    etree.SubElement(mode_el, "ConfirmationQuality", Value=_num_attr(_PLACEHOLDER_CONFIRMATION_QUALITY), Units="percent")
    etree.SubElement(mode_el, "ConfirmationQuantity", Value=_num_attr(_PLACEHOLDER_CONFIRMATION_QUANTITY), Units="count")

    # Engineered (raw +/- delta) — the PRS format has no raw/delta split of
    # its own, just a single Min/Max pair, so this is the one place that
    # distinction needs to collapse. See Raw vs. engineered values in
    # FEATURES.md for what delta means on a manually-authored line; a
    # cartesian-generated line already has the delta baked into min/max, so
    # its own `rf_delta` etc. are null and apply_delta is a no-op for it.
    rf_min, rf_max = apply_delta(line.get("rf_min_mhz"), line.get("rf_max_mhz"), line.get("rf_delta"))
    pw_min, pw_max = apply_delta(line.get("pw_min_us"), line.get("pw_max_us"), line.get("pw_delta"))
    etree.SubElement(mode_el, "Frequency", Min=_num_attr(rf_min), Max=_num_attr(rf_max), Units="MHz")
    etree.SubElement(mode_el, "PulseWidth", Min=_num_attr(pw_min), Max=_num_attr(pw_max), Units="us")

    pri_type = mode["pri_type"]
    pri_el = etree.SubElement(mode_el, "PRI", Class=_PRI_CLASS_MAP.get(pri_type, "Unknown"))

    if pri_type == "fixed":
        pri_min, pri_max = apply_delta(line.get("pri_min_us"), line.get("pri_max_us"), line.get("pri_delta"))
        etree.SubElement(pri_el, "SimplePRI", Min=_num_attr(pri_min), Max=_num_attr(pri_max), Units="us")
        etree.SubElement(
            pri_el, "Jitter", Min=_num_attr(line.get("jitter_min_us")), Max=_num_attr(line.get("jitter_max_us")), Units="us"
        )
        etree.SubElement(pri_el, "IntrapulseData", Name="default")
    elif pri_type == "stagger":
        values = line.get("pri_stagger_values_us") or []
        frame_time = compute_frametime_us(values) if values else 0
        ft_min, ft_max = apply_delta(frame_time, frame_time, line.get("frame_time_delta_us"))
        etree.SubElement(pri_el, "FramePeriod", Min=_num_attr(ft_min), Max=_num_attr(ft_max), Units="us")
        stagger_el = etree.SubElement(pri_el, "StaggerLevels", Count=str(len(values)))
        for v in values:
            etree.SubElement(stagger_el, "Level", Value=_num_attr(v), Units="us")
        etree.SubElement(pri_el, "IntrapulseData", Name="default")
    elif pri_type == "xlet":
        # Xlet carries no fields anywhere in this app yet (see PriType.xlet in
        # FEATURES.md) — emit the block's required structure with zeros
        # rather than omitting it, matching the real sample's own shape.
        etree.SubElement(pri_el, "FramePeriod", Min="0", Max="0", Units="us")
        etree.SubElement(pri_el, "XletsPerGroup", Min="0", Max="0", Units="count")
        etree.SubElement(pri_el, "GroupsPerFrame", Min="0", Max="0", Units="count")
        etree.SubElement(pri_el, "XletGap", Min="0", Max="0", Units="us")
        etree.SubElement(pri_el, "IntrapulseData", Name="default")
    # CW: <PRI Class="CW" /> with no children at all — confirmed against the
    # real sample, do not add a nested element here.

    etree.SubElement(mode_el, "ScanData", Name=_sanitize(scan_name))


def build_platform_element(platform_snapshot: dict) -> etree._Element:
    root = etree.Element("Platform", IsUnknown="false")
    etree.SubElement(root, "Name").text = _sanitize(platform_snapshot["name"])
    # Not modeled anywhere in this app — see prs_export_notes.md.
    etree.SubElement(root, "Hostility", Value=_PLACEHOLDER_HOSTILITY)
    etree.SubElement(root, "Base", Value=_PLACEHOLDER_BASE)
    etree.SubElement(root, "Speed", Min="0", Max="0", Units="kph")

    config_el = etree.SubElement(root, "Configuration")
    for link in platform_snapshot.get("links", []):
        file_el = etree.SubElement(config_el, "EmitterFile", Count="1")
        file_el.text = f"emitters\\{sanitize_filename(link['emitter_name'])}.xml"

    return root


def build_library_root(*, mdf_id: str, mdf_name: str) -> etree._Element:
    root = etree.Element("ThreatLibrary", nsmap={None: PRS_NAMESPACE})
    etree.SubElement(root, "DefaultUnknown").text = "platforms\\default_unknown_platform.xml"
    mdf_el = etree.SubElement(root, "MDF", Id=str(mdf_id))
    etree.SubElement(mdf_el, "Name").text = _sanitize(mdf_name)
    return root


def to_xml_bytes(element: etree._Element) -> bytes:
    return etree.tostring(element, encoding="utf-8", xml_declaration=True, pretty_print=True)
