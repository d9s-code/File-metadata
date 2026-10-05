"""A language model behind an OpenAI-compatible API — vLLM, typically, on the
same network. Only the standard library is used, so nothing extra has to be
installed on an offline server.

Replies are asked for as JSON matching a Pydantic model: first with the
`response_format` JSON-schema option (vLLM's structured output, which makes
the model unable to answer in any other shape), then with vLLM's older
`guided_json` option, and last as plain instructions — so it works with
older servers too. The reply is always validated against the model.
"""

import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.config import settings

T = TypeVar("T", bound=BaseModel)


class LlmError(Exception):
    """The model couldn't be reached, or didn't give a usable answer."""


class LlmNotConfigured(LlmError):
    pass


@dataclass
class LlmReply:
    model: str
    seconds: float
    prompt_tokens: int | None
    completion_tokens: int | None


def enabled() -> bool:
    return bool(settings.llm_base_url)


def _base() -> str:
    if not settings.llm_base_url:
        raise LlmNotConfigured("No language model is set up — set LLM_BASE_URL")
    return settings.llm_base_url.rstrip("/")


def _request(method: str, path: str, body: dict | None = None, timeout: float | None = None) -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if settings.llm_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{_base()}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout or settings.llm_timeout_seconds) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:500]
        raise _HttpError(err.code, detail) from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise LlmError(f"Couldn't reach the language model at {_base()}: {getattr(err, 'reason', err)}") from err
    except json.JSONDecodeError as err:
        raise LlmError("The language model's server sent something that isn't JSON") from err


class _HttpError(LlmError):
    def __init__(self, code: int, detail: str):
        super().__init__(f"The language model's server answered {code}: {detail}")
        self.code = code


_model_cache: dict[str, str] = {}


def model_name() -> str:
    """LLM_MODEL, or the first model the server offers."""
    if settings.llm_model:
        return settings.llm_model
    base = _base()
    if base not in _model_cache:
        models = _request("GET", "/models", timeout=15).get("data") or []
        if not models:
            raise LlmError("The language model's server lists no models — set LLM_MODEL")
        _model_cache[base] = models[0]["id"]
    return _model_cache[base]


def server_info() -> dict:
    """What the server says about itself: its models and how long a context
    each allows (vLLM reports max_model_len)."""
    models = _request("GET", "/models", timeout=15).get("data") or []
    return {"models": [{"id": m.get("id"), "max_model_len": m.get("max_model_len")} for m in models]}


def _parse(content: str, schema: type[T]) -> T:
    text = content.strip()
    # Fenced or chatty replies: take the outermost {...}.
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise LlmError("The language model didn't answer in the expected form")
        text = text[start : end + 1]
    try:
        return schema.model_validate_json(text)
    except ValidationError as err:
        raise LlmError(f"The language model's answer was incomplete: {err.errors()[0]['msg']}") from err


def chat_json(system: str, user: str, schema: type[T], *, max_tokens: int | None = None) -> tuple[T, LlmReply]:
    """Ask the model, and get its answer as `schema`."""
    model = model_name()
    json_schema = schema.model_json_schema()
    base_body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": max_tokens or settings.llm_max_tokens,
    }
    attempts = [
        {"response_format": {"type": "json_schema", "json_schema": {"name": schema.__name__, "schema": json_schema}}},
        {"guided_json": json_schema},
        {},
    ]
    started = time.monotonic()
    last_error: LlmError | None = None
    for extra in attempts:
        body = {**base_body, **extra}
        if not extra:
            body["messages"] = [
                {
                    "role": "system",
                    "content": f"{system}\n\nAnswer with only a JSON object matching this schema:\n{json.dumps(json_schema)}",
                },
                {"role": "user", "content": user},
            ]
        try:
            reply = _request("POST", "/chat/completions", body)
        except _HttpError as err:
            # An older server not knowing the option: try the next way of asking.
            if err.code in (400, 422) and extra:
                last_error = err
                continue
            raise
        choice = (reply.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content") or ""
        if choice.get("finish_reason") == "length":
            raise LlmError("The language model's answer was cut off — raise LLM_MAX_TOKENS")
        usage = reply.get("usage") or {}
        meta = LlmReply(
            model=reply.get("model") or model,
            seconds=round(time.monotonic() - started, 1),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
        )
        return _parse(content, schema), meta
    raise last_error or LlmError("The language model didn't answer")
