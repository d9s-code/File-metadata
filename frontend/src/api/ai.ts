import { api } from "./client";
import type { AiSource } from "./ambiguity";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** An answer's lookups, sent back with the next question so they're run
   * again for it — the chat's memory of what it found. */
  lookups?: Record<string, unknown>[];
}

/** One lookup the model made before answering. */
export interface ChatStep {
  action: string;
  label: string;
  /** The lookup as asked, to send back with the next question. */
  args?: Record<string, unknown>;
}

export interface ChatLink {
  text: string;
  url: string;
}

export interface ChatReply {
  reply: string;
  steps: ChatStep[];
  sources: AiSource[];
  unknown_citations: string[];
  unverified_numbers: string[];
  /** Whether it was told which page the question was asked on. */
  page: boolean;
  /** How many earlier lookups were run again and given with this question. */
  remembered?: number;
  /** Names in the answer that open their page (longest first). */
  links?: ChatLink[];
  model: string;
  seconds: number;
  prompt_tokens: number;
  completion_tokens: number;
}

/** One message of a saved chat. */
export interface SavedChatMessage {
  role: "user" | "assistant";
  content: string;
  /** An answer's details: lookups, sources, warnings. */
  reply?: ChatReply;
  /** Why the model couldn't answer — the question can be asked again. */
  error?: boolean;
}

export interface SavedChatSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface SavedChat extends SavedChatSummary {
  messages: SavedChatMessage[];
}

export interface ChatAsk {
  content: string;
  page: string | null;
  /** Replaces a failed question and its error rather than keeping them. */
  retry?: boolean;
}

export const aiApi = {
  chat: (messages: ChatTurn[], page: string | null) => api.post<ChatReply>("/ai/chat", { messages, page }),
  /** Your saved chats, the latest first. */
  chats: () => api.get<SavedChatSummary[]>("/ai/chats"),
  getChat: (id: string) => api.get<SavedChat>(`/ai/chats/${id}`),
  /** A new chat, named after its first question, with the answer. */
  startChat: (ask: ChatAsk) => api.post<SavedChat>("/ai/chats", ask),
  ask: (id: string, ask: ChatAsk) => api.post<SavedChat>(`/ai/chats/${id}/messages`, ask),
  renameChat: (id: string, title: string) => api.patch<SavedChat>(`/ai/chats/${id}`, { title }),
  deleteChat: (id: string) => api.delete<void>(`/ai/chats/${id}`),
};
