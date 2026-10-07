"""The language-model drafts on ambiguity findings and runs, against a small
fake OpenAI-compatible server — so the real HTTP path is exercised,
including the fallbacks for servers that don't know an option."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.config import settings
from app.services import llm_client
from app.services.ai_review_service import unverified_numbers

from tests.integration.test_ambiguity_api import emitter_with_two_overlapping_modes  # noqa: F401  (fixture)

EXPLANATION = {
    "explanation": "Both Modes cover RF 2900–3100 MHz, PRI 800–1200 µs and PW 0.5–1.2 µs, so they overlap 100% everywhere.",
    "distinguishing": "Nothing in the data",
    "recommendation": "merge_modes",
    "recommendation_detail": "Merge Mode 2 into Mode 1; they are identical.",
    "confidence": "high",
}
SUMMARY = {
    "overview": "One exact overlap, between Mode 1 and Mode 2.",
    "priorities": ["Mode 1 × Mode 2"],
    "patterns": ["Identical Modes in one EW group"],
}


class FakeLlm:
    """Answers /models and /chat/completions; each test sets what it says."""

    def __init__(self):
        self.requests: list[dict] = []
        self.reply: dict = EXPLANATION
        self.raw_content: str | None = None
        self.reject_options: set[str] = set()

    def handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code: int, payload: dict):
                body = json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/v1/models":
                    self._send(200, {"data": [{"id": "fake-gemma", "max_model_len": 262144}]})
                else:
                    self._send(404, {})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fake.requests.append(body)
                rejected = fake.reject_options & body.keys()
                if rejected:
                    self._send(400, {"error": f"unknown option {sorted(rejected)}"})
                    return
                content = fake.raw_content if fake.raw_content is not None else json.dumps(fake.reply)
                self._send(
                    200,
                    {
                        "model": body["model"],
                        "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 500, "completion_tokens": 120},
                    },
                )

        return Handler


@pytest.fixture()
def fake_llm(monkeypatch):
    fake = FakeLlm()
    server = HTTPServer(("127.0.0.1", 0), fake.handler())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(settings, "llm_base_url", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setattr(settings, "llm_model", None)
    llm_client._model_cache.clear()
    yield fake
    server.shutdown()


def _finding(client, emitter_id):
    run = client.post("/ambiguity/runs", json={"scope_type": "emitter", "scope_id": emitter_id}).json()
    findings = client.get(f"/ambiguity/runs/{run['id']}/findings").json()
    return run, findings[0]


def test_nothing_is_asked_without_a_model_set_up(editor_client, emitter_with_two_overlapping_modes):  # noqa: F811
    assert editor_client.get("/ai/status").json() == {"enabled": False, "model": None, "documentation": None}
    _, finding = _finding(editor_client, emitter_with_two_overlapping_modes["emitter"]["id"])
    resp = editor_client.post(f"/ambiguity/findings/{finding['id']}/explain")
    assert resp.status_code == 503
    assert "LLM_BASE_URL" in resp.json()["detail"]


def test_explaining_a_finding_sends_only_that_pair_and_keeps_the_draft(
    viewer_client, editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    assert editor_client.get("/ai/status").json()["enabled"] is True
    _, finding = _finding(editor_client, emitter_with_two_overlapping_modes["emitter"]["id"])

    # Anyone signed in may ask — it changes no engineering data.
    resp = viewer_client.post(f"/ambiguity/findings/{finding['id']}/explain")
    assert resp.status_code == 200, resp.text
    draft = resp.json()["ai_explanation"]
    assert draft["recommendation"] == "merge_modes"
    assert draft["recommendation_label"] == "Merge the two Modes"
    assert draft["model"] == "fake-gemma"  # found from /models, LLM_MODEL being unset
    assert draft["generated_by"] == "viewer_t"
    assert draft["unverified_numbers"] == []

    sent = fake_llm.requests[0]
    assert sent["response_format"]["type"] == "json_schema"
    context = sent["messages"][1]["content"]
    assert "Mode 1" in context and "Mode 2" in context
    assert "RF: 2900–3100 MHz (margin ±1 MHz)" in context
    assert "Computed overlap: RF 100%, PW 100%, PRI 100%" in context

    # Kept: asking again doesn't ask the model again, unless refreshed.
    editor_client.post(f"/ambiguity/findings/{finding['id']}/explain")
    assert len(fake_llm.requests) == 1
    editor_client.post(f"/ambiguity/findings/{finding['id']}/explain?refresh=true")
    assert len(fake_llm.requests) == 2
    run_findings = editor_client.get(f"/ambiguity/runs/{finding['run_id']}/findings").json()
    assert run_findings[0]["ai_explanation"]["generated_by"] == "editor_t"


def test_numbers_the_model_made_up_are_listed(editor_client, fake_llm, emitter_with_two_overlapping_modes):  # noqa: F811
    fake_llm.reply = {**EXPLANATION, "recommendation_detail": "Narrow Mode 2 to RF 3,050–3100 MHz."}
    _, finding = _finding(editor_client, emitter_with_two_overlapping_modes["emitter"]["id"])
    draft = editor_client.post(f"/ambiguity/findings/{finding['id']}/explain").json()["ai_explanation"]
    assert draft["unverified_numbers"] == ["3,050"]


def test_an_older_server_is_asked_the_older_way(editor_client, fake_llm, emitter_with_two_overlapping_modes):  # noqa: F811
    fake_llm.reject_options = {"response_format"}
    _, finding = _finding(editor_client, emitter_with_two_overlapping_modes["emitter"]["id"])
    resp = editor_client.post(f"/ambiguity/findings/{finding['id']}/explain")
    assert resp.status_code == 200, resp.text
    assert "guided_json" in fake_llm.requests[-1]

    # And a server knowing neither: plain instructions, a fenced answer still read.
    fake_llm.reject_options = {"response_format", "guided_json"}
    fake_llm.raw_content = f"Here you go:\n```json\n{json.dumps(EXPLANATION)}\n```"
    resp = editor_client.post(f"/ambiguity/findings/{finding['id']}/explain?refresh=true")
    assert resp.status_code == 200, resp.text
    assert "JSON object" in fake_llm.requests[-1]["messages"][0]["content"]


def test_an_unusable_answer_is_an_error_and_nothing_is_kept(
    editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    fake_llm.raw_content = "I think they overlap."
    _, finding = _finding(editor_client, emitter_with_two_overlapping_modes["emitter"]["id"])
    resp = editor_client.post(f"/ambiguity/findings/{finding['id']}/explain")
    assert resp.status_code == 502
    fake_llm.raw_content = json.dumps({**EXPLANATION, "recommendation": "delete_everything"})
    assert editor_client.post(f"/ambiguity/findings/{finding['id']}/explain").status_code == 502
    findings = editor_client.get(f"/ambiguity/runs/{finding['run_id']}/findings").json()
    assert findings[0]["ai_explanation"] is None


def test_a_run_summary_gets_counts_and_the_serious_findings(
    editor_client, fake_llm, emitter_with_two_overlapping_modes  # noqa: F811
):
    fake_llm.reply = SUMMARY
    run, _ = _finding(editor_client, emitter_with_two_overlapping_modes["emitter"]["id"])
    resp = editor_client.post(f"/ambiguity/runs/{run['id']}/summary")
    assert resp.status_code == 200, resp.text
    summary = resp.json()["ai_summary"]
    assert summary["overview"].startswith("One exact overlap")
    assert summary["findings_total"] == 1
    context = fake_llm.requests[0]["messages"][1]["content"]
    assert "By severity: exact overlap 1, high 0, medium 0, low 0." in context
    assert "Mode 1 (Ambiguity Emitter) × Mode 2 (Ambiguity Emitter)" in context or "Mode 2 (Ambiguity Emitter) × Mode 1" in context
    assert editor_client.get(f"/ambiguity/runs/{run['id']}").json()["ai_summary"]["model"] == "fake-gemma"


def test_unverified_numbers_ignores_small_counts_and_given_values():
    context = "RF 2900–3100 MHz, overlap 85.5%"
    assert unverified_numbers("2 Modes overlap 85.5% across 2,900 to 3100 MHz", context) == []
    assert unverified_numbers("PW 1.25 µs and RF 9.2 GHz", context) == ["1.25", "9.2"]
