import { api } from "./client";
import type { AiSource } from "./ambiguity";
import type { Mode } from "../types/domain";

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
  /** How much of the context the answer took. */
  context_tokens?: number;
  /** Modes proposed for the user to add — nothing is added until they do. */
  proposals?: ModeProposal[];
  /** Edits to existing Modes proposed for the user to apply — nothing changes until they do. */
  edit_proposals?: ModeEditProposal[];
}

/** A Mode the chat proposed, as checked by the app. */
export interface ModeProposal {
  id: string;
  name: string;
  pri_type: "fixed" | "stagger" | "cw" | "xlet";
  emitter_id: string | null;
  emitter_name: string;
  ew_group_id: string | null;
  ew_group_name: string;
  source_id: string | null;
  source_name: string | null;
  /** Every Source it comes from, main one first (proposals before this: source_name only). */
  source_names?: string[];
  confirmation_quality?: number | null;
  confirmation_quantity?: number | null;
  /** Test runs its values come from. */
  derived_test_titles?: string[];
  notes: string | null;
  line: Record<string, number | number[] | boolean | null>;
  /** The Mode line as it'd be written. */
  dsl: string | null;
  /** Why it can't be added; null when it can. */
  problem: string | null;
  status: "proposed" | "added";
  mode_id?: string;
}

/** One value an edit changes. */
export interface ModeEditChange {
  field: string;
  label: string;
  unit: string;
  old: number | number[] | boolean | string | null;
  new: number | number[] | boolean | string | null;
}

/** An edit to an existing Mode the chat proposed, as checked by the app. */
export interface ModeEditProposal {
  id: string;
  emitter_id: string | null;
  emitter_name: string;
  mode_id: string | null;
  mode_name: string;
  ew_group_name: string | null;
  pri_type: string | null;
  reason: string | null;
  changes: ModeEditChange[];
  /** The Mode line before and as it'd be written. */
  dsl_before: string | null;
  dsl: string | null;
  /** Why it can't be applied; null when it can. */
  problem: string | null;
  status: "proposed" | "applied";
}

/** One message of a saved chat. A "summary" stands in for the turns before
 * it, once the chat was compacted. */
export interface SavedChatMessage {
  role: "user" | "assistant" | "summary";
  content: string;
  /** Pictures sent with a question (data URLs). */
  images?: string[];
  /** A summary: how many turns it stands for, and whether it was made on its own. */
  covers?: number;
  auto?: boolean;
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
  /** Tokens the conversation takes now, and the most it may. */
  context: { used: number; max: number };
}

export interface ChatAsk {
  content: string;
  page: string | null;
  /** Replaces a failed question and its error rather than keeping them. */
  retry?: boolean;
  images?: string[];
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
  /** Summarise the chat so far; the summary stands in for it from then on. */
  compact: (id: string) => api.post<SavedChat>(`/ai/chats/${id}/compact`),
  /** Add the picked Modes of one answer's proposal — the only way they're written. */
  applyProposals: (id: string, messageIndex: number, proposalIds: string[]) =>
    api.post<{ created: Mode[]; chat: SavedChat }>(`/ai/chats/${id}/proposals/apply`, {
      message_index: messageIndex,
      proposal_ids: proposalIds,
    }),
  /** Apply the picked edits of one answer — the only way they're written. */
  applyEditProposals: (id: string, messageIndex: number, editIds: string[]) =>
    api.post<{ edited: Mode[]; chat: SavedChat }>(`/ai/chats/${id}/edit-proposals/apply`, {
      message_index: messageIndex,
      edit_ids: editIds,
    }),
};
