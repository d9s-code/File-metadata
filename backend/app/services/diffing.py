"""Structured diff between two versioned snapshots (plain JSON dicts),
normalized from DeepDiff's output into a simple {added, removed, changed}
shape the frontend Diff Viewer can render directly.
"""

from deepdiff import DeepDiff


def _path_to_str(deepdiff_path: str) -> str:
    # DeepDiff paths look like "root['ew_groups'][0]['name']" — strip the
    # "root" prefix and quoting for a cleaner display path.
    path = deepdiff_path.removeprefix("root")
    return path


def compute_diff(old_snapshot: dict, new_snapshot: dict) -> dict:
    dd = DeepDiff(old_snapshot, new_snapshot, ignore_order=False, report_repetition=True, verbose_level=2)

    added: list[dict] = []
    removed: list[dict] = []
    changed: list[dict] = []

    for path, value in dd.get("dictionary_item_added", {}).items():
        added.append({"path": _path_to_str(path), "value": value})
    for path, value in dd.get("iterable_item_added", {}).items():
        added.append({"path": _path_to_str(path), "value": value})

    for path, value in dd.get("dictionary_item_removed", {}).items():
        removed.append({"path": _path_to_str(path), "value": value})
    for path, value in dd.get("iterable_item_removed", {}).items():
        removed.append({"path": _path_to_str(path), "value": value})

    for path, change in dd.get("values_changed", {}).items():
        changed.append(
            {"path": _path_to_str(path), "old_value": change["old_value"], "new_value": change["new_value"]}
        )
    for path, change in dd.get("type_changes", {}).items():
        changed.append(
            {"path": _path_to_str(path), "old_value": change["old_value"], "new_value": change["new_value"]}
        )

    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "identical": not (added or removed or changed),
    }
