"""Saved AI chats: each person's conversations, kept so they can be read
again, carried on, renamed or deleted. Only the owner sees a chat.

A question can bring images. A long chat can be compacted: its earlier turns
are summarised by the model and the summary stands in for them from then on
(also done on its own when a question wouldn't fit the context otherwise).
Modes the model proposes are only added when the owner adds them, here —
the model itself can't write anything."""

import base64
import re
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core import preferences as user_preferences
from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.models.ai_chat import AiChat
from app.routers.modes import create_mode_record
from app.services import ai_chat_service, ai_mode_proposals, app_settings, llm_client
from app.services.mode_test_status_service import attach_mode_extras

router = APIRouter(prefix="/ai/chats", tags=["ai"])

# Earlier turns given to the model with each question.
SENT_TURNS = 10
# A chat this long is better started afresh: the model sees only the last turns anyway.
MAX_MESSAGES = 200
TITLE_CHARS = 80
# Images with one question, and how big each may be (after the browser shrinks it).
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 2_000_000
_DATA_URL = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$")
# Compacted on its own once a question would fill this much of the context.
AUTO_COMPACT_AT = 0.8


class ChatSummaryOut(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int


class ContextOut(BaseModel):
    # Tokens the conversation takes now (the model's own count after an
    # answer, else an estimate), and the most it may take.
    used: int
    max: int


class ChatOut(ChatSummaryOut):
    messages: list[dict]
    context: ContextOut


class ChatAsk(BaseModel):
    content: str = Field(min_length=1, max_length=8_000)
    # The page the question was asked on (its path), so "this Emitter" works.
    page: str | None = Field(None, max_length=300)
    # Asking again after a failed answer: the failed question and its error
    # are replaced rather than kept.
    retry: bool = False
    # Pictures with the question, as data URLs (PNG, JPEG, WebP or GIF).
    images: list[str] = Field(default=[], max_length=MAX_IMAGES)

    @field_validator("images")
    @classmethod
    def check_images(cls, images: list[str]) -> list[str]:
        for url in images:
            m = _DATA_URL.match(url)
            if not m:
                raise ValueError("An image must be a PNG, JPEG, WebP or GIF")
            if len(base64.b64decode(m.group(2), validate=True)) > MAX_IMAGE_BYTES:
                raise ValueError("An image is too large — at most 2 MB")
        return images


class ChatRename(BaseModel):
    title: str = Field(min_length=1, max_length=TITLE_CHARS)


class ProposalApply(BaseModel):
    # The answer the proposal is in (its place in the chat), and which of its Modes to add.
    message_index: int = Field(ge=0)
    proposal_ids: list[str] = Field(min_length=1, max_length=ai_mode_proposals.MAX_PROPOSED)


def _max_context(db: Session) -> int:
    return int(app_settings.get_setting(db, app_settings.AI_CHAT_MAX_CONTEXT))


def _since_summary(messages: list[dict]) -> tuple[str | None, list[dict]]:
    """The latest summary (if the chat was compacted) and the messages after it."""
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "summary":
            return messages[i]["content"], messages[i + 1 :]
    return None, messages


def _estimate(messages: list[dict]) -> int:
    """About how many tokens the conversation gives the model now."""
    summary, recent = _since_summary(messages)
    text = ai_chat_service.SYSTEM + (summary or "")
    images = 0
    for m in recent[-SENT_TURNS:]:
        if m.get("error"):
            continue
        text += str(m.get("content") or "")
        images += len(m.get("images") or [])
    return ai_chat_service.estimate_tokens(text) + ai_chat_service.IMAGE_TOKENS * images


def _context(db: Session, messages: list[dict]) -> dict:
    used = _estimate(messages)
    last = messages[-1] if messages else None
    # After an answer, the model's own count of what it was given (when it reports one).
    if last and last.get("role") == "assistant" and not last.get("error"):
        used = max(used, int((last.get("reply") or {}).get("context_tokens") or 0))
    return {"used": used, "max": _max_context(db)}


def _summary(chat: AiChat) -> dict:
    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at,
        "updated_at": chat.updated_at,
        "message_count": sum(1 for m in chat.messages or [] if m.get("role") in ("user", "assistant")),
    }


def _out(db: Session, chat: AiChat) -> dict:
    messages = chat.messages or []
    return {**_summary(chat), "messages": messages, "context": _context(db, messages)}


def _own_chat(db: Session, chat_id: UUID, user) -> AiChat:
    chat = db.get(AiChat, chat_id)
    # Someone else's chat reads as not there at all.
    if chat is None or chat.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    return chat


def _title_of(question: str) -> str:
    title = " ".join(question.split())
    return title if len(title) <= TITLE_CHARS else title[: TITLE_CHARS - 1].rstrip() + "…"


def _turns(messages: list[dict]) -> list[dict]:
    """The conversation as the model is given it: the last turns since any
    summary that weren't errors, each answer with the lookups it made (run
    again for the next one). Earlier images are mentioned, not sent again."""
    _, recent = _since_summary(messages)
    turns = []
    kept = [m for m in recent if not m.get("error") and m.get("role") in ("user", "assistant")][-SENT_TURNS:]
    for i, m in enumerate(kept):
        content = m["content"]
        # The question being asked brings its images themselves.
        if m.get("images") and i < len(kept) - 1:
            content += f"\n[{len(m['images'])} image(s) were attached here]"
        turn = {"role": m["role"], "content": content}
        lookups = [s["args"] for s in (m.get("reply") or {}).get("steps", []) if s.get("args")]
        if lookups:
            turn["lookups"] = lookups
        turns.append(turn)
    return turns


COMPACT_SYSTEM = """You summarise a conversation between an analyst and the assistant of an app for a radar \
emitter library, so it can go on without the full transcript. Keep everything a follow-up could need: what was \
asked, the Emitters, Platforms, Modes and values found (names, numbers with units, exactly), conclusions, open \
questions, and any Modes proposed and whether they were added. Leave out pleasantries. Plain text, short \
paragraphs or "- " lists."""


class CompactReply(BaseModel):
    summary: str = Field(description="The conversation so far, summarised")


def _compact(messages: list[dict]) -> list[dict]:
    """The chat with its turns so far summarised: the summary (any earlier one
    included) goes in after them and stands in for them from then on."""
    summary, recent = _since_summary(messages)
    turns = [m for m in recent if not m.get("error") and m.get("role") in ("user", "assistant")]
    if not turns:
        raise ValueError("There's nothing new to compact")
    transcript = "\n\n".join(
        f"{'Analyst' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        + (f"\n[{len(m['images'])} image(s)]" if m.get("images") else "")
        + "".join(
            f"\n[Proposed Mode {p['name']} on {p['emitter_name']} › {p['ew_group_name']}: {p['status']}]"
            for p in (m.get("reply") or {}).get("proposals", [])
        )
        for m in turns
    )
    if summary:
        transcript = f"Summary of what came before:\n{summary}\n\n{transcript}"
    reply, _ = llm_client.chat_json(COMPACT_SYSTEM, transcript[-60_000:], CompactReply)
    return [*messages, {"role": "summary", "content": reply.summary.strip(), "covers": len(turns)}]


def _answer(db: Session, chat: AiChat, payload: ChatAsk, user) -> None:
    """Adds the question to the chat and the model's answer after it — or,
    if the model can't be asked, why not, kept as an error to ask again."""
    messages = list(chat.messages or [])
    if payload.retry and messages and messages[-1].get("error"):
        messages = messages[:-2]
    if len(messages) >= MAX_MESSAGES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This chat is long — start a new one")
    question = {"role": "user", "content": payload.content.strip()}
    if payload.images:
        question["images"] = payload.images
    max_context = _max_context(db)
    page = payload.page if user_preferences.resolved(user.preferences)["ai_chat_page"] else None
    try:
        # A question that wouldn't fit beside what came before: compact first.
        if _estimate([*messages, question]) > AUTO_COMPACT_AT * max_context and _since_summary(messages)[1]:
            messages = _compact(messages)
            messages[-1]["auto"] = True
        messages.append(question)
        summary, _ = _since_summary(messages)
        reply = ai_chat_service.chat(
            db, _turns(messages), page, images=payload.images or None, summary=summary, max_context=max_context
        )
        messages.append({"role": "assistant", "content": reply["reply"], "reply": reply})
    except (llm_client.LlmError, ValueError) as err:
        if not messages or messages[-1] is not question:
            messages.append(question)
        messages.append({"role": "assistant", "content": str(err) or "The model couldn't be asked", "error": True})
    # A new list, so the change is saved.
    chat.messages = messages
    chat.updated_at = func.now()


@router.get("", response_model=list[ChatSummaryOut])
def list_chats(db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))) -> list[dict]:
    """Your chats, the latest first."""
    chats = db.query(AiChat).filter(AiChat.user_id == user.id).order_by(AiChat.updated_at.desc()).all()
    return [_summary(c) for c in chats]


@router.post("", response_model=ChatOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def start_chat(payload: ChatAsk, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))) -> dict:
    """A new chat, named after its first question, with the answer to it."""
    chat = AiChat(user_id=user.id, title=_title_of(payload.content), messages=[])
    db.add(chat)
    _answer(db, chat, payload, user)
    db.commit()
    db.refresh(chat)
    return _out(db, chat)


@router.get("/{chat_id}", response_model=ChatOut)
def get_chat(chat_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))) -> dict:
    return _out(db, _own_chat(db, chat_id, user))


@router.post("/{chat_id}/messages", response_model=ChatOut, dependencies=[Depends(verify_csrf)])
def ask_in_chat(
    chat_id: UUID, payload: ChatAsk, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))
) -> dict:
    """The next question in a chat, answered with what came before in mind."""
    chat = _own_chat(db, chat_id, user)
    _answer(db, chat, payload, user)
    db.commit()
    db.refresh(chat)
    return _out(db, chat)


@router.post("/{chat_id}/compact", response_model=ChatOut, dependencies=[Depends(verify_csrf)])
def compact_chat(chat_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))) -> dict:
    """Summarises the chat so far; the summary stands in for those turns from now on."""
    chat = _own_chat(db, chat_id, user)
    try:
        chat.messages = _compact(list(chat.messages or []))
    except ValueError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(err)) from err
    except llm_client.LlmError as err:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err
    chat.updated_at = func.now()
    db.commit()
    db.refresh(chat)
    return _out(db, chat)


@router.post("/{chat_id}/proposals/apply", dependencies=[Depends(verify_csrf)])
def apply_proposals(
    chat_id: UUID, payload: ProposalApply, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> dict:
    """Adds the Modes the owner picked from one of the chat's proposals — the
    only way anything the chat proposes gets written. All or none, checked
    again, into Emitters the owner is editing."""
    chat = _own_chat(db, chat_id, user)
    messages = list(chat.messages or [])
    if payload.message_index >= len(messages) or messages[payload.message_index].get("role") != "assistant":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That answer isn't in this chat")
    message = dict(messages[payload.message_index])
    reply = dict(message.get("reply") or {})
    items = [dict(p) for p in reply.get("proposals") or []]
    try:
        created = ai_mode_proposals.apply(db, items, payload.proposal_ids, create_mode_record, user)
    except ai_mode_proposals.ApplyProblem as err:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(err)) from err
    reply["proposals"] = items
    message["reply"] = reply
    messages[payload.message_index] = message
    chat.messages = messages
    flag_modified(chat, "messages")
    db.commit()
    for mode in created:
        db.refresh(mode)
    return {"created": attach_mode_extras(db, created), "chat": _out(db, chat)}


@router.patch("/{chat_id}", response_model=ChatOut, dependencies=[Depends(verify_csrf)])
def rename_chat(
    chat_id: UUID, payload: ChatRename, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))
) -> dict:
    chat = _own_chat(db, chat_id, user)
    chat.title = " ".join(payload.title.split())
    # A new name isn't new activity: the chat keeps its place in the list.
    flag_modified(chat, "updated_at")
    db.commit()
    db.refresh(chat)
    return _out(db, chat)


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_chat(chat_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))) -> None:
    db.delete(_own_chat(db, chat_id, user))
    db.commit()
