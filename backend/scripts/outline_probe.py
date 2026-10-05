"""Look at what the language model could be given from Outline — read-only.

    python scripts/outline_probe.py                       # sign-in check, list collections
    python scripts/outline_probe.py --collection "PRS"    # that collection's pages and size
    python scripts/outline_probe.py --collection "PRS" --search "stagger"

Run it where the backend runs (in Docker: docker compose exec backend python
scripts/outline_probe.py), with OUTLINE_URL and OUTLINE_API_TOKEN set as for
the app (and OUTLINE_COLLECTION to skip --collection).

It signs in, lists the collections that account can read, and for one
collection lists every page: how many sections (headings) it has, roughly
how many tokens, and when it last changed. Then it says whether the whole
collection could go with every question, or only the relevant sections
should. --search tries Outline's own search. Nothing is written anywhere,
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--collection", default=settings.outline_collection, help="collection name or id")
    parser.add_argument("--search", help="try Outline's search with this text")
    parser.add_argument("--dump", help="save every page as Markdown in this folder")
    args = parser.parse_args()

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
    if not args.collection:
        print("\nPass --collection NAME (or set OUTLINE_COLLECTION) to look inside one.")
        return 0

    collection = next(
        (c for c in found if c["id"] == args.collection or c["name"].strip().lower() == args.collection.strip().lower()),
        None,
    )
    if collection is None:
        print(f'\nNo collection "{args.collection}" that this account can read.')
        return 1

    try:
        docs = outline_client.documents(collection["id"])
    except outline_client.OutlineError as err:
        print(f"Failed reading the pages: {err}")
        return 1

    print(f'\n"{collection["name"]}": {len(docs)} pages')
    print(f"  {'tokens':>7}  {'sections':>8}  {'last changed':<12}  title")
    total = 0
    all_sections: list[tuple[str, str]] = []
    for doc in sorted(docs, key=lambda d: d.title.lower()):
        secs = outline_client.sections(doc)
        all_sections += secs
        tokens = outline_client.estimate_tokens(doc.text)
        total += tokens
        print(f"  {tokens:>7}  {len(secs):>8}  {(doc.updated_at or '')[:10]:<12}  {doc.title}")
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
    if sizes and sizes[-1][0] > 4_000:
        print("Some sections are long — more headings in those pages would make picking the relevant part sharper.")

    if args.search:
        print(f'\nOutline search for "{args.search}":')
        try:
            hits = outline_client.search(args.search, collection["id"])
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
