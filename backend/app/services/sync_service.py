"""Syncing an offline copy of the database (the standalone app) back into the server.

How it works
------------
The standalone app fetches a whole copy of the server's database and keeps an
untouched copy of it (the *base*). Back online, it sends what changed since
then: every row inserted, updated or deleted on the PC, with the row as it was
in the base and as it is on the PC (`compute_changes`). The server compares each
with the row as it is on the server now — a three-way comparison, field by field
(`plan_sync`):

* changed only on the PC → taken;
* changed only on the server → kept;
* changed on both to different values → a *conflict*.

Conflicts are grouped by what they belong to — an Emitter, Platform, MDF, Dwell
Strategy, dwell file, intercept … — and a person picks, per group, whether the
server or the PC wins (`resolutions`). Changes without a conflict go in either
way. History is simply added together (versions, audit entries, tests, notes):
a version number both sides used is renumbered after the server's, and a name
both sides gave a new Emitter (Platform, MDF …) gets " (from PC)" added.

`apply_sync` writes the lot in one transaction: deletes first (children before
parents), then inserts and updates (parents before children).

Not synced: user accounts (the server's are kept; a PC change to a password or
role doesn't travel), the app's settings, the AI chats and the Outline cache,
and who holds an Emitter's edit lock.
"""

from __future__ import annotations

import base64
import enum
import hashlib
import json
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import Table, select, text, tuple_
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.engine import Connection
from sqlalchemy.sql import sqltypes

from app.database import Base
import app.models  # noqa: F401  (registers every table)

#: Never synced: the server's own state, or nothing a person made.
SKIP_TABLES = {"users", "app_settings", "knowledge_sections", "knowledge_sync", "ai_chats"}
#: Columns that never travel from the PC: who holds the edit lock is the server's business.
LOCAL_ONLY_COLUMNS = {"emitters": {"checked_out_by_id", "checked_out_at"}}
#: Columns that change along with any other change: never a conflict on their own.
SOFT_COLUMNS = {"updated_at"}
#: What conflicts are grouped under, and the column that names one.
OWNER_TABLES = {
    "emitters": ("Emitter", "name"),
    "platforms": ("Platform", "name"),
    "mdfs": ("MDF", "name"),
    "dwell_strategies": ("Dwell Strategy", "name"),
    "dwell_files": ("Dwell file", "name"),
    "intercepts": ("Intercept", "name"),
    "source_groups": ("Source Group", "name"),
    "customers": ("Customer", "name"),
    "tasks": ("Task", "title"),
    "status_definitions": ("Status", "label"),
    "milestone_definitions": ("Milestone", "name"),
    "test_records": ("Test run", "title"),
}
#: Names that must be unique: a new one both sides made is kept, with this added on the PC's.
RENAME_SUFFIX = " (from PC)"
#: Version numbers per parent: (parent column, number column).
NUMBERED = {
    "emitter_versions": ("emitter_id", "version_number"),
    "platform_versions": ("platform_id", "version_number"),
    "mdf_versions": ("mdf_id", "version_number"),
    "dwell_file_versions": ("dwell_file_id", "version_number"),
    "dwell_strategy_versions": ("strategy_id", "version_number"),
}


class SyncError(ValueError):
    """The sync can't go ahead — the message says why, for a person."""


# --- Tables and rows ----------------------------------------------------------


def synced_tables() -> list[Table]:
    """Parents before children."""
    return [t for t in Base.metadata.sorted_tables if t.name not in SKIP_TABLES]


def _table(name: str) -> Table:
    if name in SKIP_TABLES or name not in Base.metadata.tables:
        raise SyncError(f"'{name}' isn't something that syncs")
    return Base.metadata.tables[name]


def _columns(t: Table) -> list:
    return [c for c in t.columns if c.computed is None]


def _pk_cols(t: Table) -> list[str]:
    return [c.name for c in t.primary_key.columns]


def row_key(t: Table, row: dict) -> str:
    return "|".join(str(row[c]) for c in _pk_cols(t))


def _dump(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, enum.Enum):
        return value.name
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, memoryview)):
        return {"$b64": base64.b64encode(bytes(value)).decode()}
    if isinstance(value, (list, tuple)):
        return [_dump(v) for v in value]
    if isinstance(value, dict):
        return {k: _dump(v) for k, v in value.items()}
    return str(value)


def dump_row(t: Table, row) -> dict:
    """A row as JSON-safe values, the same on every side so they compare equal."""
    return {c.name: _dump(row[c.name]) for c in _columns(t)}


def _load(coltype, value):
    if value is None:
        return None
    if isinstance(coltype, ARRAY):
        return [_load(coltype.item_type, v) for v in value]
    if isinstance(coltype, UUID):
        return uuid.UUID(value) if isinstance(value, str) else value
    if isinstance(coltype, sqltypes.Enum) and coltype.enum_class is not None:
        return coltype.enum_class[value] if isinstance(value, str) else value
    if isinstance(coltype, sqltypes.DateTime):
        return datetime.fromisoformat(value) if isinstance(value, str) else value
    if isinstance(coltype, sqltypes.Date):
        return date.fromisoformat(value) if isinstance(value, str) else value
    if isinstance(coltype, sqltypes.Time):
        return time.fromisoformat(value) if isinstance(value, str) else value
    if isinstance(coltype, sqltypes.Numeric) and not isinstance(coltype, sqltypes.Float):
        return Decimal(value) if isinstance(value, str) else value
    if isinstance(coltype, sqltypes.LargeBinary) and isinstance(value, dict):
        return base64.b64decode(value["$b64"])
    return value


def load_row(t: Table, data: dict) -> dict:
    return {c.name: _load(c.type, data.get(c.name)) for c in _columns(t) if c.name in data}


def _fetch(conn: Connection, t: Table, keys: list[tuple]) -> dict[str, dict]:
    """The rows of `t` with these primary keys, dumped, by row key."""
    out: dict[str, dict] = {}
    pk = [t.c[c] for c in _pk_cols(t)]
    for i in range(0, len(keys), 500):
        chunk = keys[i : i + 500]
        where = pk[0].in_([k[0] for k in chunk]) if len(pk) == 1 else tuple_(*pk).in_(chunk)
        for row in conn.execute(select(*_columns(t)).where(where)).mappings():
            d = dump_row(t, row)
            out[row_key(t, d)] = d
    return out


def _parse_key(t: Table, key: str) -> tuple:
    parts = key.split("|")
    return tuple(_load(t.c[name].type, part) for name, part in zip(_pk_cols(t), parts))


def schema_version(conn: Connection) -> str | None:
    """The database's migration version (None for one made without migrations, as in tests)."""
    if conn.execute(text("SELECT to_regclass('alembic_version')")).scalar() is None:
        return None
    return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


# --- The PC's side: what changed since the copy was fetched --------------------


def _hashes(conn: Connection, t: Table) -> dict[str, str]:
    pk = ", ".join(f'"{c}"' for c in _pk_cols(t))
    cols = ", ".join(f'"{c.name}"' for c in _columns(t))
    rows = conn.execute(text(f'SELECT {pk}, md5(ROW({cols})::text) FROM "{t.name}"')).all()
    return {"|".join(str(v) for v in r[:-1]): r[-1] for r in rows}


def compute_changes(local: Connection, base: Connection) -> dict:
    """Every row inserted, updated or deleted on the PC since the base copy, with
    the row on both sides — plus, as context, the PC's copy of each parent they
    hang under (so the server can put back a parent it has deleted meanwhile)."""
    changes: list[dict] = []
    present: dict[str, dict[str, dict]] = defaultdict(dict)  # local rows sent, by table and key
    for t in synced_tables():
        lh, bh = _hashes(local, t), _hashes(base, t)
        inserted = [k for k in lh if k not in bh]
        deleted = [k for k in bh if k not in lh]
        updated = [k for k in lh if k in bh and lh[k] != bh[k]]
        if not (inserted or deleted or updated):
            continue
        local_rows = _fetch(local, t, [_parse_key(t, k) for k in inserted + updated])
        base_rows = _fetch(base, t, [_parse_key(t, k) for k in deleted + updated])
        for k in inserted:
            changes.append({"table": t.name, "key": k, "base": None, "local": local_rows[k]})
        for k in updated:
            changes.append({"table": t.name, "key": k, "base": base_rows[k], "local": local_rows[k]})
        for k in deleted:
            changes.append({"table": t.name, "key": k, "base": base_rows[k], "local": None})
        present[t.name].update(local_rows)

    context: dict[str, dict[str, dict]] = defaultdict(dict)
    todo = [(c["table"], c["local"]) for c in changes if c["local"]]
    while todo:
        name, row = todo.pop()
        for col in Base.metadata.tables[name].columns:
            for fk in col.foreign_keys:
                parent = fk.column.table
                value = row.get(col.name)
                if value is None or parent.name in SKIP_TABLES or len(parent.primary_key.columns) != 1:
                    continue
                if value in present[parent.name] or value in context[parent.name]:
                    continue
                found = _fetch(local, parent, [(_load(fk.column.type, value),)])
                if found:
                    context[parent.name].update(found)
                    todo.append((parent.name, found[value]))
    return {
        "schema": schema_version(local),
        "changes": changes,
        "context": [{"table": n, "key": k, "local": r} for n, rows in context.items() for k, r in rows.items()],
    }


# --- The copy the PC takes away -------------------------------------------------

#: Left out of the copy: other people's AI chats and the Outline cache.
NOT_COPIED = {"knowledge_sections", "knowledge_sync", "ai_chats"}


def export_copy(conn: Connection) -> dict:
    """The whole database as JSON-safe rows — what the standalone app loads.
    User accounts come along (people sign in on the PC as on the server)."""
    tables = {}
    for t in Base.metadata.sorted_tables:
        if t.name in NOT_COPIED:
            continue
        tables[t.name] = [dump_row(t, r) for r in conn.execute(select(*_columns(t))).mappings()]
    return {"schema": schema_version(conn), "tables": tables}


def load_copy(conn: Connection, copy: dict) -> dict[str, int]:
    """Replaces everything in this (the PC's) database with a copy from the server.
    The database must be at the copy's version already (migrated)."""
    if copy.get("schema") != schema_version(conn):
        raise SyncError(
            f"The copy is from database version {copy.get('schema')}, and this app is at "
            f"{schema_version(conn)} — use the same version of the app as the server."
        )
    names = [t.name for t in Base.metadata.sorted_tables if t.name not in NOT_COPIED]
    conn.execute(text("TRUNCATE " + ", ".join(f'"{n}"' for n in names) + " CASCADE"))
    counts = {}
    for name in names:  # parents before children
        t = Base.metadata.tables[name]
        rows = _parents_first(t, copy["tables"].get(name, []))
        for i in range(0, len(rows), 1000):
            conn.execute(t.insert(), [load_row(t, r) for r in rows[i : i + 1000]])
        counts[name] = len(rows)
    return counts


# --- The server's side: the plan ----------------------------------------------


@dataclass
class Conflict:
    table: str
    key: str
    kind: str  # "field" | "server_deleted" | "pc_deleted" | "parent_deleted" | "being_edited"
    fields: list[dict] = field(default_factory=list)  # {name, base, server, pc}
    note: str = ""


@dataclass
class Group:
    key: str
    kind: str
    label: str
    conflicts: list[Conflict] = field(default_factory=list)
    changes: int = 0


@dataclass
class Op:
    table: str
    key: str
    action: str  # "insert" | "update" | "delete"
    values: dict  # dumped values (insert: the whole row; update: the columns to set)
    group: str


@dataclass
class Plan:
    groups: dict[str, Group]
    ops: list[Op]
    notes: list[str]
    unresolved: list[str]

    def summary(self) -> dict:
        counts: dict[str, int] = defaultdict(int)
        for op in self.ops:
            counts[op.action] += 1
        return dict(counts)


def _owner_label(name: str, row: dict | None) -> str:
    if row is None:
        return "(gone)"
    kind, col = OWNER_TABLES[name]
    return str(row.get(col) or row.get("name") or row.get("id"))


class _Rows:
    """Rows looked up by table and key: the PC's (changes and context), the
    server's (fetched as needed) and the base copy's."""

    def __init__(self, conn: Connection, payload: dict):
        self.conn = conn
        self.local: dict[str, dict[str, dict]] = defaultdict(dict)
        self.base: dict[str, dict[str, dict]] = defaultdict(dict)
        self.context: dict[str, dict[str, dict]] = defaultdict(dict)
        self.server: dict[str, dict[str, dict | None]] = defaultdict(dict)
        for c in payload["changes"]:
            if c.get("local") is not None:
                self.local[c["table"]][c["key"]] = c["local"]
            if c.get("base") is not None:
                self.base[c["table"]][c["key"]] = c["base"]
        for c in payload.get("context", []):
            self.context[c["table"]][c["key"]] = c["local"]

    def load_server(self, name: str, keys) -> None:
        t = Base.metadata.tables[name]
        missing = [k for k in keys if k not in self.server[name]]
        if not missing:
            return
        found = _fetch(self.conn, t, [_parse_key(t, k) for k in missing])
        for k in missing:
            self.server[name][k] = found.get(k)

    def on_server(self, name: str, key: str) -> dict | None:
        self.load_server(name, [key])
        return self.server[name][key]

    def any(self, name: str, key: str) -> dict | None:
        return (
            self.local[name].get(key)
            or self.context[name].get(key)
            or self.on_server(name, key)
            or self.base[name].get(key)
        )


def _fk_targets(t: Table) -> list[tuple[str, Table]]:
    """(column, parent table) for each single-column foreign key, required ones first."""
    out = []
    for col in sorted(t.columns, key=lambda c: c.nullable):
        for fk in col.foreign_keys:
            if len(fk.column.table.primary_key.columns) == 1:
                out.append((col.name, fk.column.table))
    return out


def _owner(rows: _Rows, name: str, row: dict | None, depth: int = 0) -> tuple[str, str, str]:
    """(group key, kind, label) — what a row belongs to, for grouping conflicts."""
    if name in OWNER_TABLES and row is not None:
        return f"{name}:{row['id']}", OWNER_TABLES[name][0], _owner_label(name, row)
    if row is not None and depth < 8:
        for col, parent in _fk_targets(Base.metadata.tables[name]):
            value = row.get(col)
            if value is None or parent.name in SKIP_TABLES or parent.name == name:
                continue
            found = _owner(rows, parent.name, rows.any(parent.name, value), depth + 1)
            if not found[0].startswith("other:"):
                return found
    return f"other:{name}", "Other", name.replace("_", " ")


def _same(a, b) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def plan_sync(conn: Connection, payload: dict, *, user_id: uuid.UUID, resolutions: dict[str, str] | None = None) -> Plan:
    """What syncing these changes would do, and the conflicts to settle first."""
    resolutions = resolutions or {}
    server_schema = schema_version(conn)
    if payload.get("schema") != server_schema:
        raise SyncError(
            f"The app on the PC is a different version from the server's (database version "
            f"{payload.get('schema')} on the PC, {server_schema} on the server). Update the app on the PC "
            "to the same version as the server and sync again — nothing was changed."
        )
    rows = _Rows(conn, payload)
    changes = payload["changes"]
    by_table: dict[str, list[dict]] = defaultdict(list)
    for c in changes:
        _table(c["table"])
        by_table[c["table"]].append(c)
    for name, items in by_table.items():
        rows.load_server(name, [c["key"] for c in items])

    notes: list[str] = []
    user_ids = {str(u) for u in conn.execute(text("SELECT id FROM users")).scalars()}
    remap: dict[str, dict[str, str]] = defaultdict(dict)  # table → PC key → server key

    _merge_natural_keys(conn, rows, by_table, remap, notes)
    _rename_clashing_names(conn, rows, by_table, notes)
    _renumber_versions(conn, rows, by_table, notes)
    _apply_remap(rows, changes, remap)
    _prefetch_parents(rows, changes)

    groups: dict[str, Group] = {}
    ops: list[Op] = []

    def group_for(name: str, row: dict | None) -> Group:
        key, kind, label = _owner(rows, name, row)
        if key not in groups:
            groups[key] = Group(key=key, kind=kind, label=label)
        return groups[key]

    pc_wins = lambda g: resolutions.get(g.key) == "pc"  # noqa: E731

    deleted_keys = {(c["table"], c["key"]) for c in changes if c.get("local") is None}
    inserted_keys = {(c["table"], c["key"]) for c in changes if c.get("base") is None and c.get("local") is not None}

    for c in changes:
        name, key = c["table"], c["key"]
        t = Base.metadata.tables[name]
        base, local = c.get("base"), c.get("local")
        server = rows.on_server(name, key)
        local_only = LOCAL_ONLY_COLUMNS.get(name, set())
        g = group_for(name, local or server or base)
        g.changes += 1

        if local is not None:
            _fix_user_refs(t, local, user_ids, user_id)

        if local is None:  # deleted on the PC
            if server is None:
                continue
            if base is not None and _same(_strip(server, local_only), _strip(base, local_only)):
                added = _server_children_added(conn, rows, t, key, deleted_keys)
                if added:
                    g.conflicts.append(Conflict(name, key, "pc_deleted", note=f"The server has added {added} under it since"))
                    if not pc_wins(g):
                        continue
                ops.append(Op(name, key, "delete", {}, g.key))
            else:
                g.conflicts.append(Conflict(name, key, "pc_deleted", note="Deleted on the PC, changed on the server"))
                if pc_wins(g):
                    ops.append(Op(name, key, "delete", {}, g.key))
            continue

        if server is None:
            if base is None:  # new on the PC
                ops.append(Op(name, key, "insert", dict(local), g.key))
            else:  # changed on the PC, deleted on the server
                g.conflicts.append(Conflict(name, key, "server_deleted", note="Changed on the PC, deleted on the server"))
                if pc_wins(g):
                    ops.append(Op(name, key, "insert", local, g.key))
            continue

        # On both sides: field by field.
        take: dict = {}
        clash: list[dict] = []
        for col in _columns(t):
            n = col.name
            if n in local_only or n not in local:
                continue
            # A link both sides made: when and by whom it was made isn't worth a conflict.
            if base is None and (isinstance(col.type, sqltypes.DateTime) or _is_user_ref(col)):
                continue
            lv, sv = local.get(n), server.get(n)
            bv = base.get(n) if base is not None else sv if n in SOFT_COLUMNS else None
            if _same(lv, sv):
                continue
            if base is not None and _same(lv, bv):
                continue  # the PC didn't change it
            if n in SOFT_COLUMNS or (base is not None and _same(sv, bv)):
                take[n] = lv
            else:
                clash.append({"name": n, "base": bv, "server": sv, "pc": lv})
        if clash:
            g.conflicts.append(Conflict(name, key, "field", fields=clash))
            if pc_wins(g):
                take.update({f["name"]: f["pc"] for f in clash})
        if any(n not in SOFT_COLUMNS for n in take):
            ops.append(Op(name, key, "update", take, g.key))

    _check_parents(conn, rows, ops, groups, inserted_keys, deleted_keys, resolutions)
    _flag_edit_locks(rows, groups, user_id)
    # Someone is editing it on the server and the server is to win: leave it alone entirely.
    held = {
        g.key for g in groups.values()
        if any(c.kind == "being_edited" for c in g.conflicts) and resolutions.get(g.key) == "server"
    }
    ops = [op for op in ops if op.group not in held]

    unresolved = [g.key for g in groups.values() if g.conflicts and resolutions.get(g.key) not in ("pc", "server")]
    # A group the server wins keeps none of the PC's changes that clash; the rest still go in.
    return Plan(groups=groups, ops=ops, notes=notes, unresolved=unresolved)


def _prefetch_parents(rows: _Rows, changes: list[dict]) -> None:
    """The server's copy of every row the changes point at, a table at a time —
    rather than one query per link while grouping and checking."""
    wanted: dict[str, set[str]] = defaultdict(set)
    for c in changes:
        row = c.get("local") or c.get("base")
        if row is None:
            continue
        for col, parent in _fk_targets(Base.metadata.tables[c["table"]]):
            if row.get(col) is not None and parent.name not in SKIP_TABLES:
                wanted[parent.name].add(row[col])
    for name, keys in wanted.items():
        rows.load_server(name, list(keys))


def _strip(row: dict, columns: set[str]) -> dict:
    return {k: v for k, v in row.items() if k not in columns and k not in SOFT_COLUMNS}


def _is_user_ref(col) -> bool:
    return any(fk.column.table.name == "users" for fk in col.foreign_keys)


def _fix_user_refs(t: Table, row: dict, user_ids: set[str], user_id: uuid.UUID) -> None:
    """A person the server doesn't know (made on the PC): the one syncing stands in."""
    for col in t.columns:
        if any(fk.column.table.name == "users" for fk in col.foreign_keys):
            value = row.get(col.name)
            if value is not None and value not in user_ids:
                row[col.name] = None if col.nullable else str(user_id)


def _server_children_added(conn: Connection, rows: _Rows, t: Table, key: str, deleted: set) -> int:
    """How many rows on the server hang under this one but weren't in the PC's copy."""
    count = 0
    for child in synced_tables():
        for col in child.columns:
            for fk in col.foreign_keys:
                if fk.column.table is not t:
                    continue
                pk = _pk_cols(child)
                found = conn.execute(
                    select(*[child.c[c] for c in pk]).where(col == _load(fk.column.type, key))
                ).all()
                for r in found:
                    k = "|".join(str(v) for v in r)
                    if (child.name, k) in deleted or k in rows.base[child.name]:
                        continue
                    if child.name == t.name:
                        continue
                    count += 1
    return count


def _merge_natural_keys(conn, rows: _Rows, by_table, remap, notes) -> None:
    """A link both sides made (the same Emitter pinned to the same Platform, say)
    is one row: the PC's becomes an update of the server's."""
    for name, items in by_table.items():
        t = Base.metadata.tables[name]
        if name in NUMBERED or name in _NAME_UNIQUE:
            continue
        uniques = _unique_sets(t)
        if not uniques:
            continue
        deleting = {c["key"] for c in items if c.get("local") is None}
        for c in items:
            if c.get("base") is not None or c.get("local") is None or rows.on_server(name, c["key"]):
                continue
            for cols in uniques:
                values = [c["local"].get(col) for col in cols]
                if any(v is None for v in values):
                    continue
                where = [t.c[col] == _load(t.c[col].type, v) for col, v in zip(cols, values)]
                found = conn.execute(select(*_columns(t)).where(*where)).mappings().first()
                if found is None:
                    continue
                server_row = dump_row(t, found)
                server_key = row_key(t, server_row)
                if server_key in deleting:
                    continue
                remap[name][c["key"]] = server_key
                break


def _unique_sets(t: Table) -> list[tuple[str, ...]]:
    from sqlalchemy import UniqueConstraint

    sets = {tuple(c.name for c in u.columns) for u in t.constraints if isinstance(u, UniqueConstraint)}
    sets |= {tuple(c.name for c in i.columns) for i in t.indexes if i.unique}
    sets |= {(c.name,) for c in t.columns if c.unique}
    pk = tuple(_pk_cols(t))
    return [s for s in sets if s != pk]


_NAME_UNIQUE = {"emitters", "platforms", "mdfs", "dwell_files", "customers", "source_groups"}


def _rename_clashing_names(conn, rows: _Rows, by_table, notes) -> None:
    for name in _NAME_UNIQUE & set(by_table):
        t = Base.metadata.tables[name]
        taken = {r for r in conn.execute(select(t.c.name)).scalars()}
        for c in by_table[name]:
            local = c.get("local")
            if local is None:
                continue
            server = rows.on_server(name, c["key"])
            if server is not None and server.get("name") == local.get("name"):
                continue
            if local.get("name") in taken and (server is None or server.get("name") != local.get("name")):
                base_name, new, n = local["name"], local["name"] + RENAME_SUFFIX, 2
                while new in taken:
                    new, n = f"{base_name}{RENAME_SUFFIX} {n}", n + 1
                notes.append(f"{OWNER_TABLES[name][0] if name in OWNER_TABLES else name} '{base_name}' is on the server too — the PC's is called '{new}'")
                local["name"] = new
                taken.add(new)


def _renumber_versions(conn, rows: _Rows, by_table, notes) -> None:
    """A version number both sides used: the PC's goes after the server's."""
    for name, (parent_col, num_col) in NUMBERED.items():
        if name not in by_table:
            continue
        t = Base.metadata.tables[name]
        new = sorted(
            (c for c in by_table[name] if c.get("base") is None and c.get("local") is not None),
            key=lambda c: c["local"][num_col],
        )
        used: dict[str, set[int]] = {}
        for c in new:
            parent = c["local"][parent_col]
            if parent not in used:
                used[parent] = set(
                    conn.execute(
                        select(t.c[num_col]).where(t.c[parent_col] == _load(t.c[parent_col].type, parent))
                    ).scalars()
                )
            old = c["local"][num_col]
            if old in used[parent]:
                fresh = max(used[parent]) + 1
                c["local"][num_col] = fresh
                if name == "emitter_versions":
                    _renumber_checkpoints(rows, parent, old, fresh)
                label = _owner_label(_parent_owner(name), rows.any(_parent_owner(name), parent))
                notes.append(f"'{label}': the PC's v{old} is v{fresh} on the server (the server has a v{old} of its own)")
                old = fresh
            used[parent].add(old)
    # Checkpoint numbers after a version: the same, per (Emitter, version).
    if "emitter_checkpoints" in by_table:
        t = Base.metadata.tables["emitter_checkpoints"]
        used_cp: dict[tuple, set[int]] = {}
        for c in sorted(
            (c for c in by_table["emitter_checkpoints"] if c.get("base") is None and c.get("local") is not None),
            key=lambda c: c["local"]["number"],
        ):
            loc = c["local"]
            k = (loc["emitter_id"], loc["base_version_number"])
            if k not in used_cp:
                used_cp[k] = set(
                    conn.execute(
                        select(t.c.number).where(
                            t.c.emitter_id == uuid.UUID(loc["emitter_id"]), t.c.base_version_number == loc["base_version_number"]
                        )
                    ).scalars()
                )
            if loc["number"] in used_cp[k]:
                loc["number"] = max(used_cp[k]) + 1
            used_cp[k].add(loc["number"])


def _parent_owner(name: str) -> str:
    return {
        "emitter_versions": "emitters",
        "platform_versions": "platforms",
        "mdf_versions": "mdfs",
        "dwell_file_versions": "dwell_files",
        "dwell_strategy_versions": "dwell_strategies",
    }[name]


def _renumber_checkpoints(rows: _Rows, emitter_id: str, old: int, new: int) -> None:
    for row in list(rows.local["emitter_checkpoints"].values()):
        if row.get("emitter_id") != emitter_id:
            continue
        if row.get("base_version_number") == old:
            row["base_version_number"] = new
        if row.get("promoted_to_version_number") == old:
            row["promoted_to_version_number"] = new


def _apply_remap(rows: _Rows, changes: list[dict], remap) -> None:
    """Point the PC's rows at the server's copy of a merged link, and turn its
    insert into an update of that row."""
    if not any(remap.values()):
        return
    for c in changes:
        if c["table"] in remap and c["key"] in remap[c["table"]]:
            new_key = remap[c["table"]][c["key"]]
            t = Base.metadata.tables[c["table"]]
            local = c["local"]
            for col, value in zip(_pk_cols(t), new_key.split("|")):
                local[col] = value
            c["key"] = new_key
            server = rows.on_server(c["table"], new_key)
            # Its base is the server's row: only what the PC set differently goes over it.
            c["base"] = None
            rows.local[c["table"]][new_key] = local
            if server is not None:
                c["base"] = None
    for c in changes:
        local = c.get("local")
        if local is None:
            continue
        t = Base.metadata.tables[c["table"]]
        for col, parent in _fk_targets(t):
            v = local.get(col)
            if v is not None and v in remap.get(parent.name, {}):
                local[col] = remap[parent.name][v]


def _check_parents(conn, rows: _Rows, ops: list[Op], groups, inserted, deleted, resolutions) -> None:
    """A row the PC added or changed under something the server has deleted:
    a conflict. If the PC wins, the parent is put back from the PC's copy;
    otherwise the row stays out — and so, in turn, does anything under it."""
    noted: set[tuple[str, str]] = set()
    while True:
        present = {(op.table, op.key) for op in ops if op.action != "delete"}
        deleting = {(op.table, op.key) for op in ops if op.action == "delete"}
        changed = False
        for op in list(ops):
            if op.action == "delete":
                continue
            t = Base.metadata.tables[op.table]
            row = rows.local[op.table].get(op.key) or op.values
            for col, parent in _fk_targets(t):
                value = row.get(col)
                if value is None or parent.name in SKIP_TABLES or parent.name == op.table and value == op.key:
                    continue
                there = (parent.name, value) in present or rows.on_server(parent.name, value) is not None
                if there and (parent.name, value) not in deleting:
                    continue
                g = groups[op.group]
                if (op.table, op.key) not in noted:
                    noted.add((op.table, op.key))
                    label = OWNER_TABLES.get(parent.name, (parent.name.replace("_", " "),))[0]
                    g.conflicts.append(
                        Conflict(op.table, op.key, "parent_deleted", note=f"Added or changed on the PC under a {label} the server has deleted")
                    )
                pc_copy = rows.local[parent.name].get(value) or rows.context[parent.name].get(value)
                if resolutions.get(g.key) == "pc" and pc_copy is not None:
                    ops[:] = [o for o in ops if not (o.table == parent.name and o.key == value)]
                    ops.append(Op(parent.name, value, "insert", dict(pc_copy), g.key))
                else:
                    ops.remove(op)
                changed = True
                break
            if changed:
                break
        if not changed:
            return


def _flag_edit_locks(rows: _Rows, groups: dict[str, Group], user_id: uuid.UUID) -> None:
    for g in groups.values():
        if not g.key.startswith("emitters:") or not g.changes:
            continue
        server = rows.on_server("emitters", g.key.split(":", 1)[1])
        holder = server and server.get("checked_out_by_id")
        if holder and holder != str(user_id):
            g.conflicts.append(
                Conflict("emitters", g.key.split(":", 1)[1], "being_edited", note="Someone is editing it on the server right now")
            )


# --- Applying -------------------------------------------------------------------


def apply_sync(conn: Connection, plan: Plan) -> dict:
    """Writes the plan; the caller commits (or rolls back on an error)."""
    if plan.unresolved:
        raise SyncError("Some conflicts haven't been settled yet")
    order = {t.name: i for i, t in enumerate(synced_tables())}
    deletes = sorted((o for o in plan.ops if o.action == "delete"), key=lambda o: -order[o.table])
    upserts = sorted((o for o in plan.ops if o.action != "delete"), key=lambda o: order[o.table])
    for op in deletes:
        t = Base.metadata.tables[op.table]
        conn.execute(t.delete().where(*_pk_where(t, op.key)))
    for name, items in _group_by_table(upserts):
        t = Base.metadata.tables[name]
        for op in _self_ordered(t, items):
            values = load_row(t, op.values)
            if op.action == "insert":
                conn.execute(t.insert().values(**values))
            else:
                values.pop("id", None)
                if values:
                    conn.execute(t.update().where(*_pk_where(t, op.key)).values(**values))
    return plan.summary()


def _pk_where(t: Table, key: str) -> list:
    return [t.c[c] == v for c, v in zip(_pk_cols(t), _parse_key(t, key))]


def _group_by_table(ops: list[Op]):
    out: dict[str, list[Op]] = {}
    for op in ops:
        out.setdefault(op.table, []).append(op)
    return out.items()


def _parents_first(t: Table, rows: list, values=lambda r: r, key=None) -> list:
    """Rows that point at another row of the same table (a fork of an Emitter, a
    retest of a test run) after that row."""
    self_cols = [c.name for c in t.columns if any(fk.column.table is t for fk in c.foreign_keys)]
    if not self_cols:
        return rows
    key = key or (lambda r: row_key(t, values(r)))
    pending = {key(r): r for r in rows}
    done: list = []
    while pending:
        progressed = False
        for k, r in list(pending.items()):
            refs = [values(r).get(c) for c in self_cols]
            if not any(ref in pending and ref != k for ref in refs if ref):
                done.append(r)
                del pending[k]
                progressed = True
        if not progressed:
            done.extend(pending.values())
            break
    return done


def _self_ordered(t: Table, ops: list[Op]) -> list[Op]:
    return _parents_first(t, ops, values=lambda op: op.values, key=lambda op: op.key)


def plan_to_json(plan: Plan) -> dict:
    groups = sorted(plan.groups.values(), key=lambda g: (not g.conflicts, g.kind, g.label.lower()))
    return {
        "summary": plan.summary(),
        "notes": plan.notes,
        "unresolved": plan.unresolved,
        "groups": [
            {
                "key": g.key,
                "kind": g.kind,
                "label": g.label,
                "changes": g.changes,
                "conflicts": [
                    {"table": c.table, "kind": c.kind, "note": c.note, "fields": c.fields} for c in g.conflicts
                ],
            }
            for g in groups
            if g.changes
        ],
    }


def payload_digest(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]
