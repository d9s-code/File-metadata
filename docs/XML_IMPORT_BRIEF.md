# XML Import — Implementation Brief

Written for whoever (human or AI agent) implements XML import next. It covers
what exists today, in detail, and flags exactly what's still undecided.

**Read this first, in order:** this doc → [FEATURES.md §3](FEATURES.md#3-modes-the-dsl-elements--editorial-tools)
(Elements/DSL/import) and [§11](FEATURES.md#11-xml-export) (XML export) → the
actual source files referenced throughout.

---

## There are two different "XML import" ideas in play — pick one first

This is the single most important thing to resolve before writing code, and
it isn't decided anywhere in the codebase today:

**(A) Datasheet/parametric-data import** — parse an uploaded XML document
describing a Source's RF/PW/PRI building blocks (and optionally parameter
sequences), and turn it into `Source` + `ModeElement`/`ParameterSequence`
rows. This is what the frontend stub already gestures at: `ElementsPanel.tsx`
has an "Import from XML — coming soon" button sitting next to the Cartesian
Product tool, scoped to one Source's element pool.

**(B) MDF round-trip import** — parse an XML document in the *same shape the
app already exports* (§11 below) and reconstruct Emitters/Platforms/MDFs
from it, i.e. the reverse of `serialize_mdf_snapshot_to_xml`. Nothing in the
codebase points at this today — no stub button, no schema, no discussion —
but "the import function to the XML format" could mean this instead of (A).

These are structurally very different (A imports *raw source data* at the
Source/Element level, before any Mode exists; B imports *already-resolved*
Mode Lines at the MDF/Platform/Emitter level, downstream of the DSL/cartesian
tools entirely) and need different code. **Confirm which one (or both, and in
which order) is wanted before scoping further.** Everything below documents
the groundwork for both, since either path reuses it.

---

## What already exists: the parametric-import JSON API (feeds path A)

There's a complete, tested, working import pipeline today — it just doesn't
have an XML parser in front of it yet. It takes structured JSON, not XML.

**Endpoints** (`backend/app/routers/imports.py`):
- `POST /emitters/{emitter_id}/imports/validate` — dry-run, returns field-path-addressable issues, never writes.
- `POST /emitters/{emitter_id}/imports` — validates again (never trusts an earlier `/validate` call, in case DB state changed), then commits.

**Payload shape** (`backend/app/schemas/import_batch.py`):

```python
ImportPayload:
  document_name: str
  document_reference: str | None
  parametric_sets: list[ParametricSetImport]   # non-empty

ParametricSetImport:                            # → becomes one Source
  source_name: str
  source_description: str | None
  source_date: date
  elements: list[ModeElementCreate]             # elements or sequences (or
  sequences: list[ParameterSequenceCreate]       #   both) must be non-empty
```

`ModeElementCreate` (`backend/app/schemas/mode_element.py`) — one RF/PW/PRI/Scan building block:
```python
element_type: ElementType            # rf | pw | pri | scan
variant: ElementVariant | None       # typical | discrete | most_probable | extreme
value_min, value_max: float | None   # required for non-PRI types, and for Fixed-style PRI
stagger_values: list[float] | None   # PRI-only, mutually exclusive with value_min/max
jitter_min, jitter_max: float | None # Fixed-style PRI only
delta: float | None                  # tolerance margin — REQUIRED if stagger_values is
                                      #   set (repurposed as frame-time tolerance, see
                                      #   FEATURES.md §3 Frame Time), optional otherwise
label: str | None
sort_order: int
```

`ParameterSequenceCreate` (`backend/app/schemas/parameter_sequence.py`) — an ordered dwell sequence, a separate concept from cartesian-product elements:
```python
label: str | None
variant: ElementVariant | None
steps: list[ParameterSequenceStepIn]   # non-empty, unique `order` values
sort_order: int

ParameterSequenceStepIn:
  order: int
  rf_mhz, pw_us, pri_us, scan_value: float | None   # at least one required
  dwell_s: float | None
```

**Persistence** (`backend/app/services/import_service.py`): one `ImportBatch`
row, then one `Source` per `ParametricSetImport` (status starts
`pending_review` — imported Sources always need a human sign-off, unlike
manually-created ones which are immediately `approved`), with its
`ModeElement`/`ParameterSequence` children. All fully tested — see
`backend/tests/integration/test_imports_api.py` if present, or add coverage
there.

**The straightforward version of path (A)** is: build a client-side or
server-side XML→`ImportPayload` transformer, then call the existing
`/validate` and `` (create) endpoints unchanged. No new persistence logic
needed — just the parsing layer, plus wiring the "Import from XML" button in
`ElementsPanel.tsx` to a file-upload + parse + preview (reuse `/validate`'s
structured issues for a pre-commit review step) + confirm flow.

**What's NOT decided:** the actual input XML shape. There's no sample
document and no XSD for *incoming* data anywhere in this repo — only for
the outgoing export format (see below, which is itself a placeholder). If
the target system produces datasheet exports in a known format, get a real
sample before writing a parser.

---

## What already exists: the XML *export* mapping (relevant to path B, and as prior art either way)

`backend/app/xml_export/` is the export side — useful reading regardless of
which import direction you build, since path B is its literal inverse, and
even path A may want visually-consistent tag-naming conventions.

**Hierarchy walked** (`serializer.py`): `MDF → Platforms → Emitters → EW
Groups → Modes → Mode Line`. Sources and Elements are **deliberately
excluded** — they're an authoring-only construct with no meaning to the
target recognizer.

**Tag names** (`backend/app/xml_export/field_mapping.py`) — the single file
that maps internal field names to XML element names. Explicitly a
placeholder ("pending the real target XML Schema" — see the docstring at the
top of that file and `backend/app/xml_export/schema/README.md`):

| Dict | Internal fields → XML tags |
|---|---|
| `MDF` | `root="MissionDataFile"`, `id→Id`, `name→Name`, `description→Description`, `status→Status`, container `platforms_container→Platforms` |
| `PLATFORM` | `root="Platform"`, `id`, `name`, `description`, `pinned_version→PinnedVersion`, container `emitters_container→Emitters` |
| `EMITTER` | `root="Emitter"`, `id`, `name`, `designation`, `description`, `status`, `pinned_version→PinnedVersion`, container `ew_groups_container→EwGroups` |
| `EW_GROUP` | `root="EwGroup"`, `id`, `name`, `scan_min→ScanMin`, `scan_max→ScanMax`, `threat_priority→ThreatPriority`, container `modes_container→Modes` |
| `MODE` | `root="Mode"`, `id`, `name`, `pri_type→PriType`, `notes`, `line→ModeLine` |
| `MODE_LINE` | `rf_min_mhz→RfMin`, `rf_max_mhz→RfMax`, `pw_min_us→PwMin`, `pw_max_us→PwMax`, `pri_min_us→PriMin`, `pri_max_us→PriMax`, `jitter_min_us→JitterMin`, `jitter_max_us→JitterMax`, stagger container `stagger_values_container→StaggerValues` wrapping repeated `stagger_value→Value`, `dsl_text→DslText` |

**Important gap to resolve either way:** the export (and therefore this
mapping) does **not** include several fields that exist on the model today:
`rf_delta`/`pw_delta`/`pri_delta`, `frame_time_delta_us`,
`rf_range_matching`/`pw_range_matching`/`pri_range_matching` (see
[FEATURES.md's Range Matching section](FEATURES.md)), or EW Group `ageout`.
RF/PW/PRI values that *are* exported are already the **engineered** value
(raw ± delta, baked in at generation time) — see
[Raw vs. engineered values](FEATURES.md#raw-vs-engineered-values) — so the
raw/delta split is invisible in the output XML today. Scan range is the one
exception: it's exported **raw**, ignoring `scan_delta`, and `ageout` isn't
exported at all. **Decide explicitly whether an import (either direction)
needs to round-trip these fields** — if path B is built naively against the
current export shape, delta/range-matching/ageout data will be silently
lost on any export→import→export cycle.

**Data source:** the export endpoint (`GET
/mdfs/{mdf_id}/versions/{version_number}/export.xml`,
`backend/app/routers/mdfs.py`) reads directly off the *committed version's
JSONB snapshot* (`MdfVersion.snapshot`), not live tables — see
`backend/app/services/snapshots.py`'s `build_mdf_snapshot` /
`build_platform_snapshot` / `build_emitter_snapshot` for the exact nested
shape (`links[].platform_snapshot.links[].emitter_snapshot...`) if path B
needs to either read this shape directly or reconstruct equivalent live
rows.

---

## Recommended next step

Before writing any parser: get (or write, if none exists) a real sample XML
document for whichever path is confirmed, and a real XSD if the target
system has one. Everything above is either placeholder (export tags) or
undefined (import shape) — swapping in the real schema is meant to be a
data change to `field_mapping.py` / a new equivalent import-mapping file,
not a rewrite of the tree-walking logic, so get the schema right before
building around it.
