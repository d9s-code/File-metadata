"""Platform confidence rules (experimental): checking them against an MDF,
suggesting them, and "what if" — which Platforms what's heard points to.

A rule belongs to its Platform; the checks are about one MDF (its latest
saved version), since what tells Platforms apart depends on which others are
loaded with it:

- **Can't be met by its own Emitters**: hearing everything the Platform has
  doesn't meet it (it names something the Platform doesn't have).
- **Also true for** another Platform: that Platform's own Emitters meet it —
  the rule doesn't tell the two apart.
- **Could be true for** another Platform: only through look-alikes — one of
  its Modes can be taken for a Mode the rule names (the ambiguity check's
  test), so the system could report it while that Platform is what's there.
- **What it takes**: the fewest things that have to be heard together; a
  rule that needs four or more at once is flagged as likely too strict.

Suggestions are written from what's unique in the MDF (see
platform_uniqueness): a unique Emitter's unique Modes for level 3, its
unique Emitters and unique pairs for level 2, any of its Emitters for 1."""

from collections import defaultdict
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mode import Mode
from app.models.pcl_rule import PclRule
from app.services.ambiguity_service import DEFAULT_TOLERANCE
from app.services.pcl_expr import Heard, evaluate, parse, refs, to_text, ways
from app.services.platform_uniqueness import _compare, _platforms, mdf_uniqueness

# A rule whose fewest needs this many things heard at once is flagged.
STRICT_AT = 4
WAYS_SHOWN = 6
SUGGESTED_MODES = 6
SUGGESTED_PAIRS = 5


class Context:
    """One MDF version's Platforms, ready for checking rules: what each has,
    what could be reported while it's there, and what's unique."""

    def __init__(self, db: Session, snapshot: dict, tolerance: dict):
        self.db = db
        tolerance = {**DEFAULT_TOLERANCE, **tolerance}
        apply_margins = bool(tolerance.get("apply_margins", True))
        step = float(tolerance.get("stagger_step_delta_us") or 0.0)
        self.platforms = _platforms(snapshot, apply_margins)
        self.by_id = {p.id: p for p in self.platforms}
        self.uniqueness = {u["platform_id"]: u for u in mdf_uniqueness(snapshot, tolerance)}

        self.own: dict[str, Heard] = {}
        for p in self.platforms:
            self.own[p.id] = Heard(
                frozenset(p.emitters),
                frozenset((m.flat.emitter_id, m.flat.mode_name.lower()) for m in p.modes),
            )
        # Look-alikes: Modes of different Emitters that could be taken for
        # each other. Only Modes whose RF ranges meet are compared.
        everything = {(m.flat.emitter_id, m.flat.mode_id): m for p in self.platforms for m in p.modes}
        modes = sorted(everything.values(), key=lambda m: _rf(m)[0])
        alike: dict[tuple, set] = defaultdict(set)
        for i, a in enumerate(modes):
            a_hi = _rf(a)[1]
            for b in modes[i + 1 :]:
                if _rf(b)[0] > a_hi:
                    break
                if a.flat.emitter_id == b.flat.emitter_id:
                    continue
                if _compare(a, b, apply_margins, step)["confusable"]:
                    alike[_key(a)].add((b.flat.emitter_id, b.flat.mode_name.lower()))
                    alike[_key(b)].add((a.flat.emitter_id, a.flat.mode_name.lower()))
        self.reportable: dict[str, Heard] = {}
        for p in self.platforms:
            extra = {x for m in p.modes for x in alike.get(_key(m), ())}
            self.reportable[p.id] = Heard(
                self.own[p.id].emitters | {e for e, _ in extra},
                self.own[p.id].modes | extra,
            )
        # Each Emitter's Modes as the MDF has them (for naming Modes in rules).
        self.mode_names: dict[str, dict[str, str]] = defaultdict(dict)
        for p in self.platforms:
            for m in p.modes:
                self.mode_names[m.flat.emitter_id][m.flat.mode_name.lower()] = m.flat.mode_name
        self._names: dict[str, str] = {}

    # --- names --------------------------------------------------------------

    def name_of(self, emitter_id: str) -> str:
        if emitter_id not in self._names:
            e = self.db.get(Emitter, UUID(emitter_id))
            self._names[emitter_id] = e.name if e else "(deleted Emitter)"
        return self._names[emitter_id]

    # --- checking a rule ----------------------------------------------------

    def check(self, platform_id: str, condition: dict) -> dict:
        own = self.own.get(platform_id)
        others = [q for q in self.platforms if q.id != platform_id]
        also = [q.name for q in others if evaluate(condition, self.own[q.id])]
        could = [q.name for q in others if q.name not in also and evaluate(condition, self.reportable[q.id])]
        own_ok = own is not None and evaluate(condition, own)
        terms, cut = ways(condition)
        # Hearing a Mode is hearing its Emitter: an Emitter named beside one
        # of its Modes isn't one more thing to hear.
        terms = [(frozenset(a for a in t[0] if not (a[0] == "e" and any(b[0] == "m" and b[1] == a[1] for b in t[0]))), t[1]) for t in terms]
        fewest = min((len(t[0]) for t in terms), default=0)
        warnings = []
        if own is None:
            warnings.append("This Platform isn't in this MDF")
        elif not own_ok:
            warnings.append("Hearing everything this Platform has doesn't meet it")
        if also:
            warnings.append(f"Also true for {', '.join(also)} — it doesn't tell them apart")
        if could:
            warnings.append(f"Could be true for {', '.join(could)} through look-alike Modes")
        if fewest >= STRICT_AT:
            warnings.append(f"Needs {fewest} things heard at once — likely too strict; an n OF (…) is kinder")
        return {
            "refs": [self._ref(platform_id, r) for r in refs(condition)],
            "own_ok": own_ok,
            "also_true_for": also,
            "could_be_true_for": could,
            "ways": [
                {"needs": [self._label(a) for a in sorted(t[0], key=str)], "without": [self._label(a) for a in sorted(t[1], key=str)]}
                for t in terms[:WAYS_SHOWN]
            ],
            "more_ways": max(0, len(terms) - WAYS_SHOWN) + (1 if cut else 0),
            "fewest_needed": fewest,
            "warnings": warnings,
        }

    def _label(self, atom: tuple) -> str:
        if atom[0] == "e":
            return self.name_of(atom[1])
        return f"{self.name_of(atom[1])} · {atom[3]}"

    def _ref(self, platform_id: str, r: dict) -> dict:
        """What a name in a rule is, here: on this Platform, unique, shared;
        for a Mode, whether its parameter set or parameters are unique."""
        eid = r["id"]
        u = self.uniqueness.get(platform_id)
        info = next((e for e in (u or {}).get("emitters", []) if e["emitter_id"] == eid), None)
        in_mdf = any(eid in p.emitters for p in self.platforms)
        out = {
            "kind": r["op"],
            "emitter_id": eid,
            "name": self.name_of(eid),
            "mode": r.get("mode"),
            "on_platform": info is not None,
            "in_mdf": in_mdf,
            "unique": bool(info and info["unique"]),
            "shared_with": [s["platform_name"] for s in info["shared_with"]] if info else [],
            "elsewhere": [p.name for p in self.platforms if eid in p.emitters and p.id != platform_id] if not info else [],
            "mode_unique_set": None,
            "mode_unique_params": [],
        }
        if r["op"] == "mode" and info and info["unique"]:
            m = next((m for m in info["modes"] if m["mode_name"].lower() == r["mode"].lower()), None)
            if m:
                out["mode_unique_set"] = m["unique_set"]
                out["mode_unique_params"] = m["unique_params"]
        return out

    # --- suggestions ----------------------------------------------------------

    def suggestions(self, platform_id: str, existing: set[str]) -> list[dict]:
        u = self.uniqueness.get(platform_id)
        if u is None:
            return []
        out: list[dict] = []

        def add(level: int, node: dict, why: str):
            text = to_text(node, self.name_of)
            if text not in existing and all(s["text"] != text for s in out):
                out.append({"level": level, "text": text, "why": why})

        unique = [e for e in u["emitters"] if e["unique"]]
        for e in unique:
            modes = [m for m in e["modes"] if m["unique_set"]][:SUGGESTED_MODES]
            if modes:
                node = _any([{"op": "mode", "id": e["emitter_id"], "mode": m["mode_name"]} for m in modes])
                add(3, node, f"{e['emitter_name']} is only on this Platform, and no other Platform's Mode can be taken for {'these' if len(modes) > 1 else 'this one'}")
        if unique:
            add(2, _any([{"op": "emitter", "id": e["emitter_id"]} for e in unique]), "Only this Platform has " + ("these Emitters" if len(unique) > 1 else "this Emitter"))
        for pair in u["unique_pairs"][:SUGGESTED_PAIRS]:
            node = {"op": "and", "args": [{"op": "emitter", "id": e["emitter_id"]} for e in pair["emitters"]]}
            add(2, node, "Both are shared, but no other Platform has the two together")
        everyone = [{"op": "emitter", "id": e["emitter_id"]} for e in u["emitters"]]
        if everyone:
            add(1, _any(everyone), "Any of its Emitters")
        return out


def _rf(m) -> tuple[float, float]:
    lo, hi = m.line.get("rf_min_mhz"), m.line.get("rf_max_mhz")
    lo = hi if lo is None else lo
    hi = lo if hi is None else hi
    if lo is None:
        return (float("-inf"), float("inf"))
    return (float(min(lo, hi)), float(max(lo, hi)))


def _key(m) -> tuple:
    return (m.flat.platform_id, m.flat.emitter_id, m.flat.mode_id)


def _any(nodes: list[dict]) -> dict:
    return nodes[0] if len(nodes) == 1 else {"op": "or", "args": nodes}


# --- Parsing against the app's Emitters ---------------------------------------


def resolvers(db: Session, ctx: Context | None = None):
    """Name -> Emitter id (by name, else designation; case ignored), and an
    Emitter's Mode by name — its Modes now, or as the MDF has them."""
    rows = db.query(Emitter.id, Emitter.name, Emitter.designation).filter(Emitter.is_deleted.is_(False)).all()
    by_name: dict[str, list[str]] = defaultdict(list)
    by_designation: dict[str, list[str]] = defaultdict(list)
    for eid, name, designation in rows:
        by_name[name.strip().lower()].append(str(eid))
        if designation:
            by_designation[designation.strip().lower()].append(str(eid))

    def resolve(text: str):
        key = text.strip().lower()
        hits = by_name.get(key) or by_designation.get(key) or []
        if len(hits) == 1:
            return hits[0], None
        if len(hits) > 1:
            return None, f"More than one Emitter is called '{text}'"
        return None, f"No Emitter named '{text}'"

    def resolve_mode(emitter_id: str, text: str):
        key = text.strip().lower()
        if ctx is not None and key in ctx.mode_names.get(emitter_id, {}):
            return ctx.mode_names[emitter_id][key], None
        live = (
            db.query(Mode.name)
            .join(EwGroup, Mode.ew_group_id == EwGroup.id)
            .filter(EwGroup.emitter_id == UUID(emitter_id))
            .all()
        )
        for (name,) in live:
            if name.strip().lower() == key:
                return name, None
        e = db.get(Emitter, UUID(emitter_id))
        return None, f"{e.name if e else 'That Emitter'} has no Mode '{text}'"

    return resolve, resolve_mode


def parse_condition(db: Session, text: str, ctx: Context | None = None) -> dict:
    resolve, resolve_mode = resolvers(db, ctx)
    return parse(text, resolve, resolve_mode)


def rules_by_platform(db: Session, platform_ids: list[str]) -> dict[str, list[PclRule]]:
    out: dict[str, list[PclRule]] = defaultdict(list)
    if not platform_ids:
        return out
    for r in (
        db.query(PclRule)
        .filter(PclRule.platform_id.in_([UUID(p) for p in platform_ids]))
        .order_by(PclRule.level.desc(), PclRule.created_at)
        .all()
    ):
        out[str(r.platform_id)].append(r)
    return out


def what_if(ctx: Context, heard: Heard, rules: dict[str, list[PclRule]]) -> list[dict]:
    """Each Platform's level for what's heard: the highest level of its rules
    that are met, and which ones."""
    out = []
    for p in ctx.platforms:
        met = [r for r in rules.get(p.id, []) if evaluate(r.condition, heard)]
        out.append(
            {
                "platform_id": p.id,
                "platform_name": p.name,
                "level": max((r.level for r in met), default=0),
                "met": [{"id": str(r.id), "level": r.level, "text": to_text(r.condition, ctx.name_of)} for r in met],
                "rule_count": len(rules.get(p.id, [])),
            }
        )
    return sorted(out, key=lambda x: (-x["level"], x["platform_name"].lower()))
