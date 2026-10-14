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
  model: string;
  seconds: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export const aiApi = {
  chat: (messages: ChatTurn[], page: string | null) => api.post<ChatReply>("/ai/chat", { messages, page }),
};
