import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { aiApi, type ChatReply } from "../../api/ai";
import type { AiSource } from "../../api/ambiguity";
import { ApiRequestError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useAiStatus } from "../../state/hooks/useAmbiguity";
import { Cited } from "../ambiguity/AiDrafts";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** The answer's details: lookups, sources, warnings. */
  reply?: ChatReply;
  error?: boolean;
}

const STORE_KEY = "ai-chat";
// Earlier turns sent with each question (the server keeps the last ten).
const SENT_TURNS = 10;

function load(): { open: boolean; messages: Message[] } {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as { open: boolean; messages: Message[] };
  } catch {
    // no storage, or something unreadable: start afresh
  }
  return { open: false, messages: [] };
}

function save(state: { open: boolean; messages: Message[] }) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // not kept across reloads, that's all
  }
}

/** The model's text: paragraphs, "- " lists, **bold**, and [S1] citations. */
function Formatted({ text, sources }: { text: string; sources?: AiSource[] }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>
          <Cited text={part.slice(2, -2)} sources={sources} />
        </strong>
      ) : (
        <Cited key={i} text={part} sources={sources} />
      ),
    );
  const blocks: ReactNode[] = [];
  text
    .trim()
    .split(/\n\s*\n/)
    .forEach((block, b) => {
      const lines = block.split("\n").filter((l) => l.trim());
      const item = /^\s*(?:[-*•]|\d+[.)])\s+/;
      if (lines.length > 0 && lines.every((l) => item.test(l))) {
        const ordered = /^\s*\d/.test(lines[0]);
        const items = lines.map((l, i) => <li key={i}>{inline(l.replace(item, ""))}</li>);
        blocks.push(ordered ? <ol key={b}>{items}</ol> : <ul key={b}>{items}</ul>);
      } else {
        blocks.push(
          <p key={b}>
            {lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>,
        );
      }
    });
  return <>{blocks}</>;
}

function AnswerDetails({ reply }: { reply: ChatReply }) {
  const cited = reply.sources.filter((s) => s.cited);
  return (
    <div className="chat-details">
      {reply.unverified_numbers.length > 0 && (
        <p className="ai-draft-warning" role="note">
          ⚠ Not in anything it looked up — check: <strong>{reply.unverified_numbers.join(", ")}</strong>
        </p>
      )}
      {reply.unknown_citations.length > 0 && (
        <p className="ai-draft-warning" role="note">
          ⚠ Cites {reply.unknown_citations.join(", ")}, which it wasn&apos;t given.
        </p>
      )}
      {(reply.steps.length > 0 || cited.length > 0) && (
        <details>
          <summary>
            {[
              reply.steps.length > 0 && `${reply.steps.length} lookup${reply.steps.length === 1 ? "" : "s"}`,
              cited.length > 0 && `${cited.length} documentation section${cited.length === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </summary>
          {reply.steps.length > 0 && (
            <ul className="chat-steps">
              {reply.steps.map((s, i) => (
                <li key={i}>{s.label}</li>
              ))}
            </ul>
          )}
          {cited.length > 0 && (
            <ul className="ai-sources-list">
              {cited.map((s) => (
                <li key={s.ref}>
                  <span className="ai-cite">{s.ref}</span>{" "}
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.path}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      <span className="chat-meta">
        {reply.model} · {reply.seconds}s{reply.page ? " · knew this page" : ""}
      </span>
    </div>
  );
}

/** The ✦ Ask AI button in the corner, and the chat it opens. The model can
 * look things up in the library (read-only) and the documentation before it
 * answers. The conversation lives in this browser tab only. */
export function ChatWidget() {
  const { user } = useAuth();
  const status = useAiStatus({ enabled: !!user });
  const location = useLocation();
  const initial = useRef(load());
  const [open, setOpen] = useState(initial.current.open);
  const [messages, setMessages] = useState<Message[]>(initial.current.messages);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  // A new chat while a question is out: its answer is dropped.
  const conversation = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => save({ open, messages }), [open, messages]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, asking, open]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!user || !status.data?.enabled || !user.preferences.ai_chat || location.pathname === "/login") return null;

  async function send(text: string, history: Message[]) {
    const question = text.trim();
    if (!question || asking) return;
    const asked: Message[] = [...history, { role: "user", content: question }];
    setMessages(asked);
    setDraft("");
    setAsking(true);
    const id = conversation.current;
    try {
      const turns = asked
        .filter((m) => !m.error)
        .slice(-SENT_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));
      const reply = await aiApi.chat(turns, location.pathname);
      if (id !== conversation.current) return;
      setMessages([...asked, { role: "assistant", content: reply.reply, reply }]);
    } catch (err) {
      if (id !== conversation.current) return;
      const why = err instanceof ApiRequestError ? err.message : "The model couldn't be asked";
      setMessages([...asked, { role: "assistant", content: why, error: true }]);
    } finally {
      if (id === conversation.current) setAsking(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft, messages);
    }
  }

  function newChat() {
    conversation.current += 1;
    setMessages([]);
    setAsking(false);
    input.current?.focus();
  }

  // The question an error answered, to ask it again.
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.content;
  const lastFailed = messages.length > 0 && messages[messages.length - 1].error;

  if (!open) {
    return (
      <button type="button" className="chat-launcher" onClick={() => setOpen(true)} title="Ask the AI">
        ✦ Ask AI
      </button>
    );
  }

  return (
    <section className="chat-panel" aria-label="AI chat">
      <header className="chat-head">
        <strong>✦ AI chat</strong>
        <span className="hint-text">{status.data.model ?? ""}</span>
        <span className="chat-head-actions">
          {messages.length > 0 && (
            <button type="button" className="link-button" onClick={newChat}>
              New chat
            </button>
          )}
          <button type="button" className="icon-button" aria-label="Close the chat" onClick={() => setOpen(false)}>
            ✕
          </button>
        </span>
      </header>
      <div className="chat-messages" ref={scroller}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Ask about the library or the documentation. It can look up Emitters, Platforms, Modes, Intercepts and
              ambiguity checks — read-only — and find which Modes a signal would match.
            </p>
            <ul>
              {[
                "How many Emitters are validated?",
                "Which Modes would match RF 9400 MHz, PRI 1000 µs?",
                "Summarise this Emitter's Modes",
              ].map((q) => (
                <li key={q}>
                  <button type="button" className="link-button" onClick={() => void send(q, messages)}>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message ${m.role}${m.error ? " error" : ""}`}>
            {m.role === "user" ? (
              <p>{m.content}</p>
            ) : m.error ? (
              <p className="error-text">{m.content}</p>
            ) : (
              <>
                <Formatted text={m.content} sources={m.reply?.sources} />
                {m.reply && <AnswerDetails reply={m.reply} />}
              </>
            )}
          </div>
        ))}
        {asking && (
          <div className="chat-message assistant pending">
            <span className="chat-dots" aria-label="Thinking">
              <span />
              <span />
              <span />
            </span>{" "}
            <span className="hint-text">Looking things up — this can take a minute.</span>
          </div>
        )}
        {lastFailed && !asking && lastQuestion && (
          <button
            type="button"
            className="link-button chat-retry"
            onClick={() => void send(lastQuestion, messages.slice(0, -2))}
          >
            Ask again
          </button>
        )}
      </div>
      <footer className="chat-input">
        <textarea
          ref={input}
          rows={2}
          value={draft}
          placeholder="Ask a question…"
          aria-label="Your question"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="button" disabled={asking || !draft.trim()} onClick={() => void send(draft, messages)}>
          Send
        </button>
        <p className="hint-text chat-foot">
          Enter to send, Shift+Enter for a new line. Answers can be wrong — check the lookups and sources under each
          one.
        </p>
      </footer>
    </section>
  );
}
