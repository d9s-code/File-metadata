import { api } from "./client";
import type { AiSource } from "./ambiguity";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** One lookup the model made before answering. */
export interface ChatStep {
  action: string;
  label: string;
}

export interface ChatReply {
  reply: string;
  steps: ChatStep[];
  sources: AiSource[];
  unknown_citations: string[];
  unverified_numbers: string[];
  /** Whether it was told which page the question was asked on. */
  page: boolean;
  model: string;
  seconds: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export const aiApi = {
  chat: (messages: ChatTurn[], page: string | null) => api.post<ChatReply>("/ai/chat", { messages, page }),
};
