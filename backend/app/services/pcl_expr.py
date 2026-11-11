"""Platform confidence rules (experimental): the condition language.

A condition says what has to be heard for a level of confidence that it's a
given Platform:

    "Sea Search" AND "Fire Control"
    "Fire Control"."Track 2" OR "Nav Radar"
    2 OF ("Sea Search", "Nav Radar", "Fire Control")
    "Sea Search" AND NOT "Tug Radar"

- An Emitter is named as it's named in the app, in double quotes (or bare
  when it has no spaces or punctuation): it's *heard* when it or any of its
  Modes is reported.
- `"Emitter"."Mode"` names one of its Modes: heard when that Mode is.
- AND, OR, NOT (any case), brackets, and `n OF (a, b, …)`: at least n of them.
  NOT binds tightest, then AND, then OR.

Parsed into a tree of plain dicts (stored as JSON), with each Emitter by id
so a rename doesn't break a rule:

    {"op": "emitter", "id": "…"}
    {"op": "mode", "id": "…", "mode": "Track 2"}
    {"op": "and" | "or", "args": [...]}
    {"op": "not", "arg": {...}}
    {"op": "nof", "n": 2, "args": [...]}
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from itertools import combinations

# How many alternatives "what it takes" works out before it stops.
MAX_TERMS = 64


class PclSyntaxError(ValueError):
    def __init__(self, message: str, position: int):
        super().__init__(message)
        self.position = position


@dataclass
class _Tok:
    kind: str  # name, num, and, or, not, of, lparen, rparen, comma, dot, end
    text: str
    pos: int


_TOKEN = re.compile(
    r'\s*(?:(?P<q>"(?:[^"\\]|\\.)*")|(?P<num>\d+)(?![\w-])|(?P<word>[A-Za-z0-9_\-/#+]+)|(?P<p>[(),.]))'
)
_KEYWORDS = {"and": "and", "or": "or", "not": "not", "of": "of"}
_PUNCT = {"(": "lparen", ")": "rparen", ",": "comma", ".": "dot"}


def _tokens(text: str) -> list[_Tok]:
    out: list[_Tok] = []
    i = 0
    while i < len(text):
        if text[i:].strip() == "":
            break
        m = _TOKEN.match(text, i)
        if not m or m.end() == i:
            j = i + (len(text[i:]) - len(text[i:].lstrip()))
            if text[j] == '"':
                raise PclSyntaxError("A name in quotes isn't closed", j)
            raise PclSyntaxError(f"Unexpected '{text[j]}'", j)
        start = m.start(m.lastgroup)
        if m.group("q") is not None:
            out.append(_Tok("name", m.group("q")[1:-1].replace('\\"', '"'), start))
        elif m.group("num") is not None:
            out.append(_Tok("num", m.group("num"), start))
        elif m.group("word") is not None:
            w = m.group("word")
            out.append(_Tok(_KEYWORDS.get(w.lower(), "name"), w, start))
        else:
            out.append(_Tok(_PUNCT[m.group("p")], m.group("p"), start))
        i = m.end()
    out.append(_Tok("end", "", len(text)))
    return out


# A name as written -> (emitter id, or an error message).
Resolve = Callable[[str], tuple[str | None, str | None]]
# (emitter id, mode name) -> the mode's name as stored, or an error message.
ResolveMode = Callable[[str, str], tuple[str | None, str | None]]


class _Parser:
    def __init__(self, text: str, resolve: Resolve, resolve_mode: ResolveMode):
        self.toks = _tokens(text)
        self.i = 0
        self.resolve = resolve
        self.resolve_mode = resolve_mode

    def peek(self) -> _Tok:
        return self.toks[self.i]

    def take(self, kind: str, what: str) -> _Tok:
        t = self.peek()
        if t.kind != kind:
            got = "the end" if t.kind == "end" else f"'{t.text}'"
            raise PclSyntaxError(f"Expected {what}, found {got}", t.pos)
        self.i += 1
        return t

    def parse(self) -> dict:
        if self.peek().kind == "end":
            raise PclSyntaxError("Write a condition — e.g. \"Sea Search\" AND \"Fire Control\"", 0)
        node = self.or_()
        t = self.peek()
        if t.kind != "end":
            raise PclSyntaxError(f"Expected AND, OR or the end, found '{t.text}'", t.pos)
        return node

    def or_(self) -> dict:
        args = [self.and_()]
        while self.peek().kind == "or":
            self.i += 1
            args.append(self.and_())
        return args[0] if len(args) == 1 else {"op": "or", "args": args}

    def and_(self) -> dict:
        args = [self.not_()]
        while self.peek().kind == "and":
            self.i += 1
            args.append(self.not_())
        return args[0] if len(args) == 1 else {"op": "and", "args": args}

    def not_(self) -> dict:
        if self.peek().kind == "not":
            self.i += 1
            return {"op": "not", "arg": self.not_()}
        return self.atom()

    def atom(self) -> dict:
        t = self.peek()
        if t.kind == "lparen":
            self.i += 1
            node = self.or_()
            self.take("rparen", "')'")
            return node
        if t.kind == "num":
            self.i += 1
            n = int(t.text)
            self.take("of", "OF after a number")
            self.take("lparen", "'(' after OF")
            args = [self.or_()]
            while self.peek().kind == "comma":
                self.i += 1
                args.append(self.or_())
            self.take("rparen", "')' to close the list")
            if n < 1 or n > len(args):
                raise PclSyntaxError(f"{n} OF needs between 1 and {len(args)} — the list has {len(args)}", t.pos)
            return {"op": "nof", "n": n, "args": args}
        if t.kind == "name":
            self.i += 1
            emitter_id, problem = self.resolve(t.text)
            if problem:
                raise PclSyntaxError(problem, t.pos)
            if self.peek().kind == "dot":
                self.i += 1
                m = self.take("name", "a Mode's name after the dot")
                mode, problem = self.resolve_mode(emitter_id, m.text)
                if problem:
                    raise PclSyntaxError(problem, m.pos)
                return {"op": "mode", "id": emitter_id, "mode": mode}
            return {"op": "emitter", "id": emitter_id}
        got = "the end" if t.kind == "end" else f"'{t.text}'"
        raise PclSyntaxError(f"Expected an Emitter's name, NOT, a number OF or '(', found {got}", t.pos)


def parse(text: str, resolve: Resolve, resolve_mode: ResolveMode) -> dict:
    return _Parser(text, resolve, resolve_mode).parse()


def _quote(name: str) -> str:
    return '"' + name.replace('"', '\\"') + '"'


def to_text(node: dict, name_of: Callable[[str], str], top: bool = True) -> str:
    """The condition written out, with each Emitter's current name."""
    op = node["op"]
    if op == "emitter":
        return _quote(name_of(node["id"]))
    if op == "mode":
        return f"{_quote(name_of(node['id']))}.{_quote(node['mode'])}"
    if op == "not":
        inner = to_text(node["arg"], name_of, False)
        return f"NOT {inner}"
    if op == "nof":
        return f"{node['n']} OF (" + ", ".join(to_text(a, name_of, True) for a in node["args"]) + ")"
    sep = " AND " if op == "and" else " OR "
    parts = []
    for a in node["args"]:
        s = to_text(a, name_of, False)
        # OR inside AND needs brackets; AND inside OR doesn't.
        if op == "and" and a["op"] == "or":
            s = f"({s})"
        parts.append(s)
    text = sep.join(parts)
    return text


def refs(node: dict) -> list[dict]:
    """Every Emitter and Mode the condition names, in order, once each."""
    out: list[dict] = []
    seen = set()

    def walk(n):
        if n["op"] in ("emitter", "mode"):
            key = (n["op"], n["id"], n.get("mode"))
            if key not in seen:
                seen.add(key)
                out.append({k: v for k, v in n.items()})
        elif n["op"] == "not":
            walk(n["arg"])
        else:
            for a in n["args"]:
                walk(a)

    walk(node)
    return out


@dataclass(frozen=True)
class Heard:
    """What was heard: Emitters by id, and Modes as (emitter id, mode name lowercased)."""

    emitters: frozenset
    modes: frozenset


def evaluate(node: dict, heard: Heard) -> bool:
    op = node["op"]
    if op == "emitter":
        return node["id"] in heard.emitters
    if op == "mode":
        return (node["id"], node["mode"].lower()) in heard.modes
    if op == "not":
        return not evaluate(node["arg"], heard)
    if op == "and":
        return all(evaluate(a, heard) for a in node["args"])
    if op == "or":
        return any(evaluate(a, heard) for a in node["args"])
    return sum(1 for a in node["args"] if evaluate(a, heard)) >= node["n"]


# A way the condition can be met: what must be heard, and what mustn't.
Term = tuple[frozenset, frozenset]


def _atom(n: dict):
    return ("e", n["id"]) if n["op"] == "emitter" else ("m", n["id"], n["mode"].lower(), n["mode"])


def ways(node: dict, limit: int = MAX_TERMS) -> tuple[list[Term], bool]:
    """The smallest sets of things that meet the condition (each with what
    mustn't be heard), fewest first — "what it takes". Second value: whether
    there were more than `limit` and the list was cut."""
    cut = False

    def go(n, negate=False) -> list[Term]:
        nonlocal cut
        op = n["op"]
        if op in ("emitter", "mode"):
            a = _atom(n)
            return [(frozenset(), frozenset([a]))] if negate else [(frozenset([a]), frozenset())]
        if op == "not":
            return go(n["arg"], not negate)
        if op == "nof":
            # n OF (args) = OR over every n-combination of AND.
            k = n["n"]
            if negate:
                k = len(n["args"]) - k + 1  # NOT (k of m) = at least m-k+1 of the NOTs
            expanded = {"op": "or", "args": [{"op": "and", "args": list(c)} for c in combinations(n["args"], k)]}
            return go(expanded, negate)
        is_and = (op == "and") != negate
        parts = [go(a, negate) for a in n["args"]]
        if not is_and:
            out = [t for p in parts for t in p]
        else:
            out = [(frozenset(), frozenset())]
            for p in parts:
                out = [(a[0] | b[0], a[1] | b[1]) for a in out for b in p]
                if len(out) > limit * 4:
                    cut = True
                    out = out[: limit * 4]
        # A term that needs something heard and not heard at once can't happen.
        return [t for t in out if not (t[0] & t[1])]

    terms = go(node)
    # Drop any term that's a superset of another (it adds nothing).
    unique = sorted(set(terms), key=lambda t: (len(t[0]) + len(t[1]), sorted(map(str, t[0]))))
    minimal: list[Term] = []
    for t in unique:
        if not any(m[0] <= t[0] and m[1] <= t[1] for m in minimal):
            minimal.append(t)
    if len(minimal) > limit:
        cut = True
    return minimal[:limit], cut
