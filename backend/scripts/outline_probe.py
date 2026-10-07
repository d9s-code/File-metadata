"""Look at what the language model could be given from Outline — read-only.

    python scripts/outline_probe.py                       # sign-in check, list collections
    python scripts/outline_probe.py --tree                # ...and every page in them, nested
    python scripts/outline_probe.py --root https://outline.app/doc/prs-AbC123xyz   # a page and all under it
    python scripts/outline_probe.py --collection "Group 1"                         # a whole collection
    python scripts/outline_probe.py --root ... --search "stagger"
    python scripts/outline_probe.py --root ... --sections   # every section, with what to fix

Run it where the backend runs (in Docker: docker compose exec backend python
scripts/outline_probe.py), with OUTLINE_URL and OUTLINE_API_TOKEN set as for
the app (and OUTLINE_ROOT or OUTLINE_COLLECTION to skip --root/--collection;
--root or --collection replaces both, and OUTLINE_ROOT wins if both are set).
--root takes a page's address as copied from the browser, its id, or its
exact title.

It signs in, lists the collections that account can read, and for the page
and everything under it (or a whole collection) lists every page: how many sections (headings) it has, roughly
how many tokens, and when it last changed. Then it says whether the whole
collection could go with every question, or only the relevant sections
should. --search tries Outline's own search. --sections lists every section
the pages split into — the pieces the model would be given and cite — and
marks the ones too long to hand over whole, too short to make sense alone,
or under no heading at all. Nothing is written anywhere,
in Outline or here, unless --dump is given (which saves the pages as
Markdown files in a folder — mind where).
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, ".")

from app.config import settings  # noqa: E402
from app.services import llm_client, outline_client  # noqa: E402

# Above this, sending the whole collection with every question costs a small
# model too much attention and the GPU too much memory: pick sections instead.
WHOLE_COLLECTION_LIMIT = 30_000
# A section is handed to the model whole: past this it crowds out the others,
# under the other it's too little to make sense on its own.
LONG_SECTION = 1_500
SHORT_SECTION = 40


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", help="a page (address, id or title) and all under it (default: OUTLINE_ROOT)")
    parser.add_argument("--collection", help="collection name or id (default: OUTLINE_COLLECTION)")
    parser.add_argument("--tree", action="store_true", help="list every page in every collection, nested")
    parser.add_argument("--search", help="try Outline's search with this text")
    parser.add_argument("--sections", action="store_true", help="list every section, marking ones to split or merge")
    parser.add_argument("--dump", help="save every page as Markdown in this folder")
    args = parser.parse_args()
    # Either option replaces both settings, so --collection isn't overruled
    # by an OUTLINE_ROOT left in the environment (the root wins in the app).
    if not args.root and not args.collection:
        args.root, args.collection = settings.outline_root, settings.outline_collection

    if not outline_client.enabled():
        print("Set OUTLINE_URL (e.g. https://outline.app) and OUTLINE_API_TOKEN first.")
        return 1
    print(f"Outline: {settings.outline_url}")
    try:
        me = outline_client.whoami()
        print(f"Signed in as {me['user']} (team {me['team']})")
        found = outline_client.collections()
    except outline_client.OutlineError as err:
        print(f"Failed: {err}")
        return 1

    print(f"\nCollections this account can read ({len(found)}):")
    for c in found:
        print(f"  {c['name']}  [{c['id']}]")
        if args.tree:
            try:
                pages = outline_client.documents(c["id"], with_text=False)
            except outline_client.OutlineError as err:
                print(f"    (couldn't list its pages: {err})")
                continue
            for path in sorted(outline_client.page_paths(pages).values(), key=str.lower):
                print(f"    {path}")
    if not args.root and not args.collection:
        print("\nPass --root PAGE (its address) or --collection NAME to look inside — --tree shows what's there.")
        return 0

    settings.outline_root, settings.outline_collection = args.root, args.collection
    try:
        label, docs = outline_client.scope()
    except outline_client.OutlineError as err:
        print(f"\n{err}")
        return 1

    print(f"\nReading {label}: {len(docs)} pages")
    print(f"  {'tokens':>7}  {'sections':>8}  {'last changed':<12}  page")
    total = 0
    all_sections: list[tuple[str, str]] = []
    paths = outline_client.page_paths(docs)
    for doc in sorted(docs, key=lambda d: paths[d.id].lower()):
        secs = outline_client.sections(doc, paths[doc.id])
        all_sections += secs
        tokens = outline_client.estimate_tokens(doc.text)
        total += tokens
        print(f"  {tokens:>7}  {len(secs):>8}  {(doc.updated_at or '')[:10]:<12}  {paths[doc.id]}")
    empty = [d.title for d in docs if not d.text.strip()]
    sizes = sorted((outline_client.estimate_tokens(t), h) for h, t in all_sections)

    print(f"\nIn all: about {total:,} tokens in {len(all_sections)} sections.")
    if sizes:
        print(f"Sections: median {sizes[len(sizes) // 2][0]:,} tokens, largest {sizes[-1][0]:,} ({sizes[-1][1]})")
    if empty:
        print(f"Pages with no text (a PDF attachment's text isn't readable this way): {', '.join(empty)}")

    max_len = None
    if llm_client.enabled():
        try:
            models = llm_client.server_info()["models"]
            max_len = next((m["max_model_len"] for m in models if m["max_model_len"]), None)
        except llm_client.LlmError as err:
            print(f"(Couldn't ask the language model's server for its context size: {err})")
    print()
    if max_len:
        print(f"The model allows {max_len:,} tokens per request.")
    if total <= WHOLE_COLLECTION_LIMIT:
        print("Small enough to send the whole collection with every question (best with vLLM prefix caching on).")
    else:
        print(
            f"Over {WHOLE_COLLECTION_LIMIT:,} tokens: better to send only the sections relevant to each question, "
            "each cited back to its page."
        )
    long_n = sum(1 for t, _ in sizes if t > LONG_SECTION)
    short_n = sum(1 for t, _ in sizes if t < SHORT_SECTION)
    if long_n or short_n:
        print(
            f"{long_n} section(s) over {LONG_SECTION:,} tokens (split them with more headings), "
            f"{short_n} under {SHORT_SECTION} (merge, or say more) — see --sections."
        )

    if args.sections:
        page_roots = set(paths.values())
        print(f"\nSections ({len(all_sections)}), in page order:")
        for heading, text in all_sections:
            t = outline_client.estimate_tokens(text)
            note = ""
            if t > LONG_SECTION:
                note = "  ← long: split with sub-headings"
            elif t < SHORT_SECTION:
                note = "  ← very short: merge, or make it stand on its own"
            elif heading in page_roots and t > SHORT_SECTION * 5:
                note = "  ← under no heading"
            print(f"  {t:>6}  {heading}{note}")

    if args.search:
        print(f'\nOutline search for "{args.search}":')
        try:
            in_scope = {d.title for d in docs}
            hits = [
                h for h in outline_client.search(args.search, docs[0].collection_id if docs else None, limit=25)
                if h["title"] in in_scope
            ]
        except outline_client.OutlineError as err:
            print(f"  Failed: {err}")
            hits = []
        for h in hits:
            snippet = re.sub(r"<[^>]+>", "", h["context"]).replace("\n", " ")[:150]
            print(f"  {h['title']}: {snippet}")
        if not hits:
            print("  Nothing found.")

    if args.dump:
        out = Path(args.dump)
        out.mkdir(parents=True, exist_ok=True)
        for doc in docs:
            name = re.sub(r"[^\w\- ]+", "_", doc.title).strip() or doc.id
            (out / f"{name}.md").write_text(f"# {doc.title}\n\n{doc.text}\n", encoding="utf-8")
        print(f"\nSaved {len(docs)} pages to {out}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
