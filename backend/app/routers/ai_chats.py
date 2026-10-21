"""Saved AI chats: each person's conversations, kept so they can be read
again, carried on, renamed or deleted. Only the owner sees a chat."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core import preferences as user_preferences
from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.models.ai_chat import AiChat
from app.services import ai_chat_service, llm_client

router = APIRouter(prefix="/ai/chats", tags=["ai"])

# Earlier turns given to the model with each question.
SENT_TURNS = 10
# A chat this long is better started afresh: the model sees only the last turns anyway.
MAX_MESSAGES = 200
TITLE_CHARS = 80


class ChatSummaryOut(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int


class ChatOut(ChatSummaryOut):
    messages: list[dict]


class ChatAsk(BaseModel):
    content: str = Field(min_length=1, max_length=8_000)
    # The page the question was asked on (its path), so "this Emitter" works.
    page: str | None = Field(None, max_length=300)
    # Asking again after a failed answer: the failed question and its error
    # are replaced rather than kept.
    retry: bool = False


class ChatRename(BaseModel):
    title: str = Field(min_length=1, max_length=TITLE_CHARS)


def _summary(chat: AiChat) -> dict:
    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at,
        "updated_at": chat.updated_at,
        "message_count": len(chat.messages or []),
    }


def _out(chat: AiChat) -> dict:
    return {**_summary(chat), "messages": chat.messages or []}


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
    """The conversation as the model is given it: the last turns that weren't
    errors, each answer with the lookups it made (run again for the next one)."""
    turns = []
    for m in [m for m in messages if not m.get("error")][-SENT_TURNS:]:
        turn = {"role": m["role"], "content": m["content"]}
        lookups = [s["args"] for s in (m.get("reply") or {}).get("steps", []) if s.get("args")]
        if lookups:
            turn["lookups"] = lookups
        turns.append(turn)
    return turns


def _answer(db: Session, chat: AiChat, payload: ChatAsk, user) -> None:
    """Adds the question to the chat and the model's answer after it — or,
    if the model can't be asked, why not, kept as an error to ask again."""
    messages = list(chat.messages or [])
    if payload.retry and messages and messages[-1].get("error"):
        messages = messages[:-2]
    if len(messages) >= MAX_MESSAGES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This chat is long — start a new one")
    messages.append({"role": "user", "content": payload.content.strip()})
    page = payload.page if user_preferences.resolved(user.preferences)["ai_chat_page"] else None
    try:
        reply = ai_chat_service.chat(db, _turns(messages), page)
        messages.append({"role": "assistant", "content": reply["reply"], "reply": reply})
    except (llm_client.LlmError, ValueError) as err:
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
    return _out(chat)


@router.get("/{chat_id}", response_model=ChatOut)
def get_chat(chat_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))) -> dict:
    return _out(_own_chat(db, chat_id, user))


@router.post("/{chat_id}/messages", response_model=ChatOut, dependencies=[Depends(verify_csrf)])
def ask_in_chat(
    chat_id: UUID, payload: ChatAsk, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))
) -> dict:
    """The next question in a chat, answered with what came before in mind."""
    chat = _own_chat(db, chat_id, user)
    _answer(db, chat, payload, user)
    db.commit()
    db.refresh(chat)
    return _out(chat)


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
    return _out(chat)


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_chat(chat_id: UUID, db: Session = Depends(get_db), user=Depends(require_role(Role.viewer))) -> None:
    db.delete(_own_chat(db, chat_id, user))
    db.commit()
