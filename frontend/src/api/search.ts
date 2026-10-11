import { api } from "./client";

export type SearchKind = "emitter" | "mode" | "source" | "platform" | "mdf" | "intercept";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  /** Where the hit opens in the app. */
  url: string;
}

export const searchApi = {
  search: (q: string) => api.get<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`),
};
