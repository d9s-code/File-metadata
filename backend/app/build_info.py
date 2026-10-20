"""Which build of the app this is: written next to this file by
scripts/offline/build-images.sh when the images are built (the commit and
when), so a server can say which code it runs."""

import json
from functools import cache
from pathlib import Path

_FILE = Path(__file__).with_name("build_info.json")


@cache
def build_info() -> dict:
    try:
        data = json.loads(_FILE.read_text())
        return {"commit": data.get("commit"), "built_at": data.get("built_at")}
    except (OSError, ValueError):
        return {"commit": None, "built_at": None}
