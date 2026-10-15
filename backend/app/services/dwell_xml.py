"""Dwell files as XML (`dwells/<name>.xml` in a PRS export) and back.

    <DwellStrategies>
        <Settings timeout="5" setup_time="5" />
        <Strategy manual_collect_time="50">
            <RapidDF collect_time="50" dwell_time="50" freq="500" />
            <MergedMode>
                <Dwell collect_time="50" dwell_time="50"><Freq value="4000" /></Dwell>
            </MergedMode>
            <SplitMode>
                <Dwell collect_time="50" dwell_time="50"><Freq value="500" /><Freq value="750" /></Dwell>
            </SplitMode>
        </Strategy>
    </DwellStrategies>

Frequencies are in MHz and times in ms, in the file as in the app. A
Strategy's dwells are its <MergedMode>. RapidDF and Split Mode aren't edited
in the app: they're written back as read (new Strategies get the defaults
below). Files are written from snapshots (see dwell_service) — a dwell
file's, holding the saved version of each Strategy pinned in it."""

from lxml import etree

DEFAULT_COLLECT_TIME_MS = 50.0
DEFAULT_RAPID_DF = {"collect_time": "50", "dwell_time": "50", "freq": "500"}
DEFAULT_SPLIT_MODE = [{"collect_time": "50", "dwell_time": "50", "freqs": ["500", "750"]}]

_RAPID_DF_ORDER = ("collect_time", "dwell_time", "freq")

_SAFE_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)


class DwellXmlError(ValueError):
    pass


def _num(text: str | None, what: str) -> float:
    try:
        value = float(text) if text is not None else None
    except ValueError:
        value = None
    if value is None:
        raise DwellXmlError(f"{what} isn't a number: {text!r}")
    return value


def fmt(value: float) -> str:
    """A number as the file writes it: 50, not 50.0; no float noise."""
    value = float(f"{value:.12g}")
    return str(int(value)) if value.is_integer() else repr(value)


def parse_dwell_xml(content: bytes) -> dict:
    """The file's settings and Strategies, in order. Raises DwellXmlError."""
    try:
        root = etree.fromstring(content, _SAFE_PARSER)
    except etree.XMLSyntaxError as exc:
        raise DwellXmlError(f"Not readable XML: {exc}") from exc
    if etree.QName(root).localname != "DwellStrategies":
        raise DwellXmlError(f"Expected <DwellStrategies>, found <{etree.QName(root).localname}>")
    settings = root.find("Settings")
    out = {
        "timeout": _num(settings.get("timeout"), "Settings timeout") if settings is not None else 5.0,
        "setup_time": _num(settings.get("setup_time"), "Settings setup_time") if settings is not None else 5.0,
        "strategies": [],
    }
    for i, strategy in enumerate(root.findall("Strategy"), start=1):
        where = f"Strategy {i}"
        merged = []
        for dwell in strategy.findall("MergedMode/Dwell"):
            freqs = dwell.findall("Freq")
            if len(freqs) != 1:
                raise DwellXmlError(f"{where}: a dwell has {len(freqs)} frequencies, not one")
            merged.append(
                {
                    "freq_mhz": _num(freqs[0].get("value"), f"{where} frequency"),
                    "dwell_time_ms": _num(dwell.get("dwell_time"), f"{where} dwell_time"),
                    "collect_time_ms": _num(dwell.get("collect_time", str(DEFAULT_COLLECT_TIME_MS)), f"{where} collect_time"),
                }
            )
        rapid = strategy.find("RapidDF")
        split = strategy.find("SplitMode")
        out["strategies"].append(
            {
                "manual_collect_time_ms": _num(
                    strategy.get("manual_collect_time", str(DEFAULT_COLLECT_TIME_MS)), f"{where} manual_collect_time"
                ),
                "dwells": merged,
                "rapid_df": dict(rapid.attrib) if rapid is not None else None,
                "split_mode": [
                    {
                        "collect_time": d.get("collect_time"),
                        "dwell_time": d.get("dwell_time"),
                        "freqs": [f.get("value") for f in d.findall("Freq")],
                    }
                    for d in split.findall("Dwell")
                ]
                if split is not None
                else None,
            }
        )
    if not out["strategies"]:
        raise DwellXmlError("The file has no <Strategy>")
    return out


def _dwell(parent, collect_time: str, dwell_time: str, freqs: list[str]):
    el = etree.SubElement(parent, "Dwell", collect_time=collect_time, dwell_time=dwell_time)
    for freq in freqs:
        etree.SubElement(el, "Freq", value=freq)
    return el


def strategy_element(parent, strategy: dict):
    """One <Strategy> from a Strategy snapshot."""
    el = etree.SubElement(parent, "Strategy", manual_collect_time=fmt(strategy["manual_collect_time_ms"]))
    rapid_df = strategy.get("rapid_df")
    if rapid_df is not None:
        # The file's attribute order (the stored dict's order isn't kept).
        known = [k for k in _RAPID_DF_ORDER if k in rapid_df]
        rest = sorted(k for k in rapid_df if k not in _RAPID_DF_ORDER)
        rapid = etree.SubElement(el, "RapidDF")
        for key in known + rest:
            rapid.set(key, str(rapid_df[key]))
    merged = etree.SubElement(el, "MergedMode")
    for d in strategy.get("dwells") or []:
        _dwell(merged, fmt(d["collect_time_ms"]), fmt(d["dwell_time_ms"]), [fmt(d["freq_mhz"])])
    if strategy.get("split_mode") is not None:
        split = etree.SubElement(el, "SplitMode")
        for d in strategy["split_mode"]:
            _dwell(split, str(d.get("collect_time")), str(d.get("dwell_time")), [str(f) for f in d.get("freqs") or []])
    return el


def build_dwell_xml(file_snapshot: dict) -> bytes:
    """A dwell file from its snapshot: its Settings, then each pinned
    Strategy version in order."""
    root = etree.Element("DwellStrategies")
    etree.SubElement(
        root, "Settings", timeout=fmt(file_snapshot["timeout"]), setup_time=fmt(file_snapshot["setup_time"])
    )
    for link in file_snapshot.get("strategies", []):
        strategy_element(root, link["snapshot"])
    etree.indent(root, space="    ")
    # The declaration as the PRS files write it (lxml would use single quotes).
    return b'<?xml version="1.0" encoding="utf-8"?>\n' + etree.tostring(root, encoding="utf-8") + b"\n"
