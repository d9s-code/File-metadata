"""Try the language model on your own ambiguity findings before relying on it.

    python scripts/llm_eval.py --check            # can it be reached, and how
    python scripts/llm_eval.py                    # explain the latest run's findings
    python scripts/llm_eval.py --run RUN_ID --limit 30 --out llm_eval

Run it where the backend runs (in Docker: docker compose exec backend python
scripts/llm_eval.py), with LLM_BASE_URL (and LLM_MODEL if the server has
several) set as for the app.

--check asks the server what it serves and how long a context it allows,
then asks one tiny structured question and says which way of asking worked.

Without --check it asks the model to explain the most serious findings of an
ambiguity run, one at a time — exactly as the Explain button does — and
writes two files:

  <out>.md   each finding: what the model was given, and what it answered
  <out>.csv  one row per finding, with empty "correct" and "useful" columns
             for an analyst to fill in

and prints how many answers came back, how fast, and how many mention a
number that wasn't in what the model was given. Nothing is saved to the
database unless --save is given.
"""

import argparse
import csv
import json
import statistics
import sys
import time

sys.path.insert(0, ".")

from pydantic import BaseModel  # noqa: E402

from app.core.enums import AmbiguityRunStatus  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun  # noqa: E402
from app.services import llm_client  # noqa: E402
from app.services.ai_review_service import (  # noqa: E402
    SEVERITY_ORDER,
    explain_finding,
    finding_context,
    scope_label,
)


class _Ping(BaseModel):
    answer: str
    sum: int


def check() -> int:
    if not llm_client.enabled():
        print("LLM_BASE_URL isn't set.")
        return 1
    print(f"Server: {llm_client.settings.llm_base_url}")
    try:
        info = llm_client.server_info()
    except llm_client.LlmError as err:
        print(f"Couldn't list models: {err}")
        return 1
    for m in info["models"]:
        print(f"  model {m['id']}  max context {m['max_model_len'] or 'not reported'} tokens")
    print(f"Using: {llm_client.model_name()}")
    started = time.monotonic()
    try:
        answer, meta = llm_client.chat_json(
            "Answer in JSON.", 'Say "ready" as answer, and give the sum of 17 and 25.', _Ping, max_tokens=100
        )
    except llm_client.LlmError as err:
        print(f"A structured question failed: {err}")
        return 1
    print(f"Structured answer: {answer.model_dump()} in {time.monotonic() - started:.1f}s")
    print("  (the sum should be 42)")
    return 0


class _NoUser:
    username = "llm_eval"


def evaluate(run_id: str | None, limit: int, out: str, save: bool) -> int:
    db = SessionLocal()
    try:
        q = db.query(AmbiguityRun).filter(AmbiguityRun.status == AmbiguityRunStatus.complete)
        run = db.get(AmbiguityRun, run_id) if run_id else q.order_by(AmbiguityRun.created_at.desc()).first()
        if run is None:
            print("No finished ambiguity run found — run a check in the app first, or pass --run.")
            return 1
        findings = db.query(AmbiguityFinding).filter(AmbiguityFinding.run_id == run.id).all()
        findings.sort(key=lambda f: (SEVERITY_ORDER.get(f.combined_severity.value, 9), str(f.id)))
        findings = findings[:limit]
        print(f"Run {run.id}: {scope_label(db, run)}, explaining {len(findings)} findings with {llm_client.model_name()}")

        rows, md = [], [f"# Language model trial — {scope_label(db, run)}\n"]
        for i, f in enumerate(findings, 1):
            context = finding_context(db, f)
            a, b = f.details["mode_a"]["mode_name"], f.details["mode_b"]["mode_name"]
            started = time.monotonic()
            try:
                result = explain_finding(db, f, _NoUser())
                error = ""
            except llm_client.LlmError as err:
                result, error = None, str(err)
            seconds = round(time.monotonic() - started, 1)
            flag = "error" if error else (f"unverified {result['unverified_numbers']}" if result["unverified_numbers"] else "ok")
            print(f"  {i:>3}. {a} × {b}: {flag} ({seconds}s)")
            rows.append(
                {
                    "finding_id": str(f.id),
                    "mode_a": a,
                    "mode_b": b,
                    "severity": f.combined_severity.value,
                    "seconds": seconds,
                    "error": error,
                    "recommendation": result["recommendation_label"] if result else "",
                    "confidence": result["confidence"] if result else "",
                    "unverified_numbers": " ".join(result["unverified_numbers"]) if result else "",
                    "explanation": result["explanation"] if result else "",
                    "recommendation_detail": result["recommendation_detail"] if result else "",
                    "prompt_tokens": result["prompt_tokens"] if result else "",
                    "correct (y/n)": "",
                    "useful (y/n)": "",
                    "analyst comment": "",
                }
            )
            md += [f"## {i}. {a} × {b} ({f.combined_severity.value})", "", "Given:", "```", context, "```", ""]
            md += (
                [f"**Error:** {error}", ""]
                if error
                else ["Answered:", "```json", json.dumps({k: result[k] for k in (
                    "explanation", "distinguishing", "recommendation", "recommendation_detail",
                    "confidence", "unverified_numbers", "seconds", "prompt_tokens", "completion_tokens",
                )}, indent=2, ensure_ascii=False), "```", ""]
            )

        if save:
            db.commit()
        else:
            db.rollback()

        with open(f"{out}.csv", "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["finding_id"])
            writer.writeheader()
            writer.writerows(rows)
        with open(f"{out}.md", "w", encoding="utf-8") as fh:
            fh.write("\n".join(md))

        answered = [r for r in rows if not r["error"]]
        times = [r["seconds"] for r in answered]
        print()
        print(f"Answered {len(answered)} of {len(rows)}" + (f", median {statistics.median(times)}s" if times else ""))
        print(f"With a number not in the data: {sum(1 for r in answered if r['unverified_numbers'])}")
        print(f"Wrote {out}.md and {out}.csv — fill in the correct/useful columns to judge it.")
        print("Saved the explanations to the findings." if save else "Nothing was saved (use --save to keep them).")
        return 0
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="only check the server can be reached and answers")
    parser.add_argument("--run", help="the ambiguity run to use (default: the latest finished one)")
    parser.add_argument("--limit", type=int, default=20, help="how many findings, most serious first (default 20)")
    parser.add_argument("--out", default="llm_eval", help="report file name, without extension (default llm_eval)")
    parser.add_argument("--save", action="store_true", help="keep the explanations on the findings")
    args = parser.parse_args()
    if args.check:
        return check()
    return evaluate(args.run, args.limit, args.out, args.save)


if __name__ == "__main__":
    sys.exit(main())
