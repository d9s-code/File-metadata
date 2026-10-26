import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  aiApi,
  type ChatLink,
  type ChatReply,
  type SavedChat,
  type SavedChatMessage,
  type SavedChatSummary,
} from "../../api/ai";
import type { AiSource } from "../../api/ambiguity";
import { ApiRequestError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useAiStatus } from "../../state/hooks/useAmbiguity";
import { Cited, SourceKind } from "../ambiguity/AiDrafts";
import { relativeTime } from "../common/backupFormat";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { Modal } from "../common/Modal";
import { useHasRole } from "../../auth/RequireAuth";
import { useAppSettings } from "../../state/hooks/useDwells";
import { ProposalPreview } from "./ProposalPreview";
import { ChatContextSetting } from "./ChatContextSetting";
import { MAX_IMAGES, imageForChat } from "./chatImages";

/** "12.3k" for a token count. */
function tokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

/** How much of the context the chat takes, of the most it may: a bar that
 * turns amber, then red, as it fills. */
function ContextMeter({ used, max }: { used: number; max: number }) {
  const share = Math.min(1, used / Math.max(max, 1));
  const level = share >= 0.8 ? "full" : share >= 0.6 ? "filling" : "ok";
  return (
    <span
      className={`chat-context ${level}`}
      title={`About ${used.toLocaleString()} of ${max.toLocaleString()} tokens of context. Older turns are left out to fit; Compact summarises them.`}
    >
      <span className="chat-context-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      {tokens(used)} / {tokens(max)}
    </span>
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Ids the model copied from its lookups: of no use to a reader.
const ID_IN_TEXT = / ?\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]/g;

/** Text with the names it knows turned into links to their pages, and [S1]
 * citations. A name only counts as a whole word (not inside another). */
function Linked({ text, links, sources }: { text: string; links?: ChatLink[]; sources?: AiSource[] }) {
  if (!links?.length) return <Cited text={text} sources={sources} />;
  const byText = new Map(links.map((l) => [l.text, l.url]));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${links.map((l) => escape(l.text)).join("|")})(?![\\p{L}\\p{N}])`, "u");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Link key={i} to={byText.get(part) ?? "#"} className="chat-link">
            {part}
          </Link>
        ) : (
          <Cited key={i} text={part} sources={sources} />
        ),
      )}
    </>
  );
}

/** The model's text: paragraphs, "- " lists, **bold**, names of things it
 * looked up as links, and [S1] citations. */
function Formatted({ text, sources, links }: { text: string; sources?: AiSource[]; links?: ChatLink[] }) {
  const inline = (line: string) =>
    line
      .replace(ID_IN_TEXT, "")
      .split(/(\*\*[^*]+\*\*)/)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>
            <Linked text={part.slice(2, -2)} links={links} sources={sources} />
          </strong>
        ) : (
          <Linked key={i} text={part} links={links} sources={sources} />
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
                  <SourceKind kind={s.kind} />
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      <span className="chat-meta">
        {reply.model} · {reply.seconds}s{reply.page ? " · knew this page" : ""}
        {reply.remembered ? ` · used ${reply.remembered} earlier lookup${reply.remembered === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}

/** Images sent with a question, small; click one to see it full size. */
function ChatImages({ images }: { images: string[] }) {
  const [shown, setShown] = useState<number | null>(null);
  return (
    <div className="chat-images">
      {images.map((src, i) => (
        <button key={i} type="button" className="chat-image-thumb" title="Show full size" onClick={() => setShown(i)}>
          <img src={src} alt={`Image ${i + 1} sent with the question`} />
        </button>
      ))}
      {shown != null && (
        <Modal title={`Image ${shown + 1}`} onClose={() => setShown(null)} className="chat-image-dialog">
          <img src={images[shown]} alt={`Image ${shown + 1} sent with the question`} />
        </Modal>
      )}
    </div>
  );
}

// The panel's size, text size and layout, remembered in this browser.
const VIEW_KEY = "ai-chat-view";
const MIN_W = 340;
const MIN_H = 360;
const SCALES = [0.85, 0.92, 1, 1.1, 1.2, 1.35, 1.5];

interface ChatView {
  width: number;
  height: number;
  maximised: boolean;
  /** Index into SCALES. */
  scale: number;
  showHistory: boolean;
}

const DEFAULT_VIEW: ChatView = { width: 560, height: 640, maximised: false, scale: 2, showHistory: true };

function loadView(): ChatView {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { ...DEFAULT_VIEW, ...(JSON.parse(raw) as Partial<ChatView>) };
  } catch {
    // no storage: the defaults
  }
  return DEFAULT_VIEW;
}

// Whether it's open, and the chat shown, for this tab.
const SESSION_KEY = "ai-chat";
function loadSession(): { open: boolean; chatId: string | null } {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { open?: boolean; chatId?: string | null };
      return { open: !!s.open, chatId: s.chatId ?? null };
    }
  } catch {
    // start closed
  }
  return { open: false, chatId: null };
}

function store(storage: "local" | "session", key: string, value: unknown) {
  try {
    (storage === "local" ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    // not remembered, that's all
  }
}

/** One chat in the history list: open it, rename it, delete it. */
function HistoryItem({
  chat,
  current,
  onOpen,
  onRename,
  onDelete,
}: {
  chat: SavedChatSummary;
  current: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  if (editing) {
    return (
      <li className="chat-history-item editing">
        <input
          autoFocus
          aria-label="Chat name"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) {
              onRename(title.trim());
              setEditing(false);
            } else if (e.key === "Escape") {
              setTitle(chat.title);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }
  return (
    <li className={current ? "chat-history-item current" : "chat-history-item"}>
      <button type="button" className="chat-history-open" onClick={onOpen} title={chat.title} aria-current={current || undefined}>
        <span className="chat-history-title">{chat.title}</span>
        <span className="chat-history-when">{relativeTime(chat.updated_at)}</span>
      </button>
      <span className="chat-history-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Rename ${chat.title}`}
          title="Rename"
          onClick={() => {
            setTitle(chat.title);
            setEditing(true);
          }}
        >
          ✎
        </button>
        <button type="button" className="icon-button" aria-label={`Delete ${chat.title}`} title="Delete" onClick={onDelete}>
          🗑
        </button>
      </span>
    </li>
  );
}

/** The ✦ Ask AI button in the corner, and the chat it opens. The model can
 * look things up in the library (read-only) and the documentation before it
 * answers, and propose Modes the user may add (it can't write anything
 * itself). Questions can bring images; the header shows the context used,
 * and Compact summarises the chat to free it. Chats are kept (for you only) in the history beside it, to read
 * again, carry on, rename or delete; the panel can be resized from its top
 * left corner, maximised, and its text made larger or smaller. */
export function ChatWidget() {
  const { user } = useAuth();
  const status = useAiStatus({ enabled: !!user });
  const location = useLocation();
  const qc = useQueryClient();
  const { confirmDelete, dialog } = useConfirmDialog();
  const initial = useRef(loadSession());
  const [open, setOpen] = useState(initial.current.open);
  const [chatId, setChatId] = useState<string | null>(initial.current.chatId);
  const [view, setView] = useState<ChatView>(loadView);
  const [draft, setDraft] = useState("");
  // The question out now, shown until its answer is in; for which chat ("new" for one not saved yet).
  const [pending, setPending] = useState<{ chatId: string; question: string; retry: boolean } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Images to send with the next question (data URLs, already shrunk).
  const [images, setImages] = useState<string[]>([]);
  const [compacting, setCompacting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const isAdmin = useHasRole("admin");
  const appSettings = useAppSettings();
  const enabled = !!user && !!status.data?.enabled && !!user.preferences.ai_chat;

  const chats = useQuery({ queryKey: ["aiChats"], queryFn: () => aiApi.chats(), enabled: enabled && open });
  const chat = useQuery({
    queryKey: ["aiChat", chatId],
    queryFn: () => aiApi.getChat(chatId!),
    enabled: enabled && open && !!chatId,
    retry: false,
  });

  useEffect(() => store("session", SESSION_KEY, { open, chatId }), [open, chatId]);
  useEffect(() => store("local", VIEW_KEY, view), [view]);
  // A chat deleted elsewhere (another tab): back to a new one.
  useEffect(() => {
    if (chat.isError) setChatId(null);
  }, [chat.isError]);
  const messages: SavedChatMessage[] = chatId ? (chat.data?.messages ?? []) : [];
  const shownPending = pending && pending.chatId === (chatId ?? "new") ? pending : null;
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, shownPending, open]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, chatId]);

  if (!enabled || location.pathname === "/login") return null;

  async function attach(files: Iterable<File>) {
    setFailure(null);
    const room = MAX_IMAGES - images.length;
    const picked = [...files].filter((f) => f.type.startsWith("image/"));
    if (picked.length > room) setFailure(`At most ${MAX_IMAGES} images with a question.`);
    try {
      const urls = await Promise.all(picked.slice(0, Math.max(room, 0)).map(imageForChat));
      setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The image couldn't be added");
    }
  }

  async function compact() {
    if (!chatId || compacting) return;
    setCompacting(true);
    setFailure(null);
    try {
      const saved = await aiApi.compact(chatId);
      qc.setQueryData(["aiChat", saved.id], saved);
    } catch (err) {
      setFailure(err instanceof ApiRequestError ? err.message : "The chat couldn't be compacted");
    } finally {
      setCompacting(false);
    }
  }

  async function send(text: string, retry = false) {
    const question = text.trim();
    if (!question || pending) return;
    const target = chatId;
    const withImages = retry ? [] : images;
    setPending({ chatId: target ?? "new", question, retry });
    setFailure(null);
    setDraft("");
    setImages([]);
    try {
      const ask = { content: question, page: location.pathname, retry, images: withImages };
      const saved = target ? await aiApi.ask(target, ask) : await aiApi.startChat(ask);
      qc.setQueryData(["aiChat", saved.id], saved);
      void qc.invalidateQueries({ queryKey: ["aiChats"] });
      // Still on the same chat (or the new one being started): show the answer there.
      setChatId((current) => (current === target ? saved.id : current));
    } catch (err) {
      setFailure(err instanceof ApiRequestError ? err.message : "The question couldn't be sent");
      setDraft(question);
      setImages(withImages);
    } finally {
      setPending(null);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  // On a narrow screen the history covers the conversation: picking a chat closes it.
  function show(id: string | null) {
    setChatId(id);
    setFailure(null);
    if (window.innerWidth <= 600) setView((v) => ({ ...v, showHistory: false }));
    input.current?.focus();
  }

  async function rename(id: string, title: string) {
    const saved = await aiApi.renameChat(id, title);
    qc.setQueryData(["aiChat", id], saved);
    void qc.invalidateQueries({ queryKey: ["aiChats"] });
  }

  async function remove(c: SavedChatSummary) {
    if (!(await confirmDelete(`Delete the chat "${c.title}"? It can't be brought back.`, { confirmLabel: "Delete", danger: true })))
      return;
    await aiApi.deleteChat(c.id);
    qc.removeQueries({ queryKey: ["aiChat", c.id] });
    void qc.invalidateQueries({ queryKey: ["aiChats"] });
    if (chatId === c.id) setChatId(null);
  }

  // Dragging the top-left corner: the panel is pinned bottom right, so it grows up and left.
  function startResize(e: ReactPointerEvent<HTMLDivElement>) {
    if (view.maximised) return;
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY, w: view.width, h: view.height };
    const move = (ev: PointerEvent) => {
      const width = Math.max(MIN_W, Math.min(window.innerWidth - 32, from.w + from.x - ev.clientX));
      const height = Math.max(MIN_H, Math.min(window.innerHeight - 40, from.h + from.y - ev.clientY));
      setView((v) => ({ ...v, width, height }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const last = messages[messages.length - 1];
  const lastFailed = !shownPending && last?.error;
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.content;
  const title = chatId ? (chat.data?.title ?? "…") : "New chat";

  if (!open) {
    return (
      <button type="button" className="chat-launcher" onClick={() => setOpen(true)} title="Ask the AI">
        ✦ Ask AI
      </button>
    );
  }

  const style = {
    "--chat-scale": SCALES[view.scale] ?? 1,
    ...(view.maximised ? {} : { width: `min(${view.width}px, calc(100vw - 32px))`, height: `min(${view.height}px, calc(100vh - 80px))` }),
  } as CSSProperties;

  return (
    <section className={view.maximised ? "chat-panel maximised" : "chat-panel"} style={style} aria-label="AI chat">
      {!view.maximised && (
        <div className="chat-resize" onPointerDown={startResize} title="Drag to resize" aria-hidden="true" />
      )}
      <header className="chat-head">
        <button
          type="button"
          className="icon-button"
          aria-label={view.showHistory ? "Hide chat history" : "Show chat history"}
          aria-pressed={view.showHistory}
          title="Chat history"
          onClick={() => setView((v) => ({ ...v, showHistory: !v.showHistory }))}
        >
          ☰
        </button>
        <strong className="chat-title" title={title}>
          ✦ {title}
        </strong>
        <span className="hint-text">{status.data?.model ?? ""}</span>
        {chatId && chat.data?.context && <ContextMeter used={chat.data.context.used} max={chat.data.context.max} />}
        <span className="chat-head-actions">
          {chatId && (
            <button
              type="button"
              className="icon-button"
              title="Summarise the chat so far: the summary stands in for it from now on, freeing the context"
              disabled={compacting || !!pending || messages.length === 0 || messages[messages.length - 1]?.role === "summary"}
              onClick={() => void compact()}
            >
              {compacting ? "Compacting…" : "Compact"}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Chat settings"
            aria-expanded={showSettings}
            title="Chat settings"
            onClick={() => setShowSettings((s) => !s)}
          >
            ⚙
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Smaller text"
            title="Smaller text"
            disabled={view.scale === 0}
            onClick={() => setView((v) => ({ ...v, scale: Math.max(0, v.scale - 1) }))}
          >
            A−
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Larger text"
            title="Larger text"
            disabled={view.scale === SCALES.length - 1}
            onClick={() => setView((v) => ({ ...v, scale: Math.min(SCALES.length - 1, v.scale + 1) }))}
          >
            A+
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={view.maximised ? "Restore the chat's size" : "Maximise the chat"}
            title={view.maximised ? "Restore" : "Maximise"}
            onClick={() => setView((v) => ({ ...v, maximised: !v.maximised }))}
          >
            {view.maximised ? "⤡" : "⤢"}
          </button>
          <button type="button" className="icon-button" aria-label="Close the chat" onClick={() => setOpen(false)}>
            ✕
          </button>
        </span>
      </header>
      {showSettings && appSettings.data && (
        <div className="chat-settings">
          <strong>Max context</strong>
          <span className="hint-text">
            The most the chat gives the model at once. Older turns are left out to fit, and a chat about to fill it is
            compacted on its own.
          </span>
          {isAdmin ? (
            <ChatContextSetting current={appSettings.data.ai_chat_max_context_tokens} compact />
          ) : (
            <span>
              {appSettings.data.ai_chat_max_context_tokens.toLocaleString()} tokens{" "}
              <span className="hint-text">— an admin sets it</span>
            </span>
          )}
        </div>
      )}
      <div className={view.showHistory ? "chat-body with-history" : "chat-body"}>
        {view.showHistory && (
          <nav className="chat-history" aria-label="Chat history">
            <button type="button" className="button secondary small chat-new" onClick={() => show(null)}>
              + New chat
            </button>
            {chats.data && chats.data.length === 0 && <p className="hint-text">Your chats are kept here.</p>}
            <ul>
              {(chats.data ?? []).map((c) => (
                <HistoryItem
                  key={c.id}
                  chat={c}
                  current={c.id === chatId}
                  onOpen={() => show(c.id)}
                  onRename={(t) => void rename(c.id, t)}
                  onDelete={() => void remove(c)}
                />
              ))}
            </ul>
          </nav>
        )}
        <div className="chat-conversation">
          <div className="chat-messages" ref={scroller}>
            {chatId && chat.isLoading && <p className="hint-text">Loading the chat…</p>}
            {messages.length === 0 && !shownPending && !(chatId && chat.isLoading) && (
              <div className="chat-empty">
                <p>
                  Ask about the library or the documentation. It can look up Emitters, Platforms, Modes, Intercepts and
                  ambiguity checks, find which Modes a signal would match, and write Modes for you — shown as a preview
                  you add yourself; it never changes anything on its own. Attach images with 📎 or by pasting.
                </p>
                <ul>
                  {[
                    "How many Emitters are validated?",
                    "Which Modes would match RF 9400 MHz, PRI 1000 µs?",
                    "Summarise this Emitter's Modes",
                  ].map((q) => (
                    <li key={q}>
                      <button type="button" className="link-button" onClick={() => void send(q)}>
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(shownPending?.retry ? messages.slice(0, -2) : messages).map((m, i) =>
              m.role === "summary" ? (
                <details key={i} className="chat-summary">
                  <summary>
                    {m.auto ? "Compacted on its own to fit the context" : "Compacted"} — the model sees this summary
                    instead of the {m.covers ?? ""} message{m.covers === 1 ? "" : "s"} above
                  </summary>
                  <p>{m.content}</p>
                </details>
              ) : (
                <div key={i} className={`chat-message ${m.role}${m.error ? " error" : ""}`}>
                  {m.role === "user" ? (
                    <>
                      {m.images && m.images.length > 0 && <ChatImages images={m.images} />}
                      <p>{m.content}</p>
                    </>
                  ) : m.error ? (
                    <p className="error-text">{m.content}</p>
                  ) : (
                    <>
                      <Formatted text={m.content} sources={m.reply?.sources} links={m.reply?.links} />
                      {chatId && m.reply?.proposals && m.reply.proposals.length > 0 && (
                        <ProposalPreview
                          chatId={chatId}
                          messageIndex={i}
                          proposals={m.reply.proposals}
                          onSaved={(saved: SavedChat) => qc.setQueryData(["aiChat", saved.id], saved)}
                        />
                      )}
                      {m.reply && <AnswerDetails reply={m.reply} />}
                    </>
                  )}
                </div>
              ),
            )}
            {shownPending && (
              <>
                <div className="chat-message user">
                  <p>{shownPending.question}</p>
                </div>
                <div className="chat-message assistant pending">
                  <span className="chat-dots" aria-label="Thinking">
                    <span />
                    <span />
                    <span />
                  </span>{" "}
                  <span className="hint-text">Looking things up — this can take a minute.</span>
                </div>
              </>
            )}
            {lastFailed && lastQuestion && (
              <button type="button" className="link-button chat-retry" onClick={() => void send(lastQuestion, true)}>
                Ask again
              </button>
            )}
            {failure && (
              <p className="error-text" role="alert">
                {failure}
              </p>
            )}
          </div>
          <footer
            className="chat-input"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (e.dataTransfer.files.length) {
                e.preventDefault();
                void attach(e.dataTransfer.files);
              }
            }}
          >
            {images.length > 0 && (
              <div className="chat-attached">
                {images.map((src, i) => (
                  <span key={i} className="chat-attached-image">
                    <img src={src} alt={`Attached image ${i + 1}`} />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove image ${i + 1}`}
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void attach(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="icon-button chat-attach"
              aria-label="Attach images"
              title={`Attach images (up to ${MAX_IMAGES}) — or paste or drop them here`}
              disabled={!!pending || images.length >= MAX_IMAGES}
              onClick={() => fileInput.current?.click()}
            >
              📎
            </button>
            <textarea
              ref={input}
              rows={2}
              value={draft}
              placeholder={pending ? "Waiting for the answer…" : "Ask a question…"}
              aria-label="Your question"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onPaste={(e) => {
                const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                if (files.length) {
                  e.preventDefault();
                  void attach(files);
                }
              }}
            />
            <button type="button" disabled={!!pending || !draft.trim()} onClick={() => void send(draft)}>
              Send
            </button>
            <p className="hint-text chat-foot">
              Enter to send, Shift+Enter for a new line. Answers can be wrong — check the lookups and sources under each
              one.
            </p>
          </footer>
        </div>
      </div>
      {dialog}
    </section>
  );
}
