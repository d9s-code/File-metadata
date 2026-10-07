/** The words of a search: split at spaces and at the separators names use
 * (_ - . /), lowercased. */
export function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s_\-./]+/)
    .filter(Boolean);
}

/** Whether every word of the search appears somewhere in the text, in any
 * order — so "scan 6" finds "scan_fixed_6" (and "Scan 16", "6 scan"). */
export function matchesWords(text: string, words: string[]): boolean {
  if (words.length === 0) return true;
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}
