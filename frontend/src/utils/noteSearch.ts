import { UserNote } from "../types";

export function slugifyTag(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function rankNotes(
  notes: UserNote[],
  query: string,
  contextTags: string[] = []
): UserNote[] {
  const trimmed = query.trim().toLowerCase().replace(/^#/, "");
  const normalizedContextTags = contextTags.map((t) =>
    t.toLowerCase().replace(/^#/, "")
  );

  if (!trimmed) {
    // Default view: Starred notes first, then context-matching notes, then most recently updated
    return [...notes].sort((a, b) => {
      if (a.is_starred !== b.is_starred) {
        return a.is_starred ? -1 : 1;
      }
      const aHasContext = a.tags.some((t) =>
        normalizedContextTags.includes(t.toLowerCase().replace(/^#/, ""))
      );
      const bHasContext = b.tags.some((t) =>
        normalizedContextTags.includes(t.toLowerCase().replace(/^#/, ""))
      );
      if (aHasContext !== bHasContext) {
        return aHasContext ? -1 : 1;
      }
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });
  }

  const queryTerms = trimmed.split(/\s+/).filter(Boolean);
  const scored: { note: UserNote; score: number }[] = [];

  for (const note of notes) {
    let score = 0;
    const noteTags = note.tags.map((t) => t.toLowerCase().replace(/^#/, ""));
    const titleLower = note.title.toLowerCase();
    const contentLower = note.content.toLowerCase();

    // 1. Exact Tag Match: full query equals one of note's tags
    const hasExactTag = noteTags.some((t) => t === trimmed);
    if (hasExactTag) {
      score += 1000;
    }

    // 2. Partial Tag Match: one of note's tags starts with or contains the query
    const hasPartialTag =
      !hasExactTag && noteTags.some((t) => t.includes(trimmed));
    if (hasPartialTag) {
      score += 500;
    }

    // Term-by-term scoring for multi-word or partial token matches
    let termsMatched = 0;
    for (const term of queryTerms) {
      const termExactTag = noteTags.includes(term);
      const termPartialTag = noteTags.some((t) => t.includes(term));
      const termTitle = titleLower.includes(term);
      const termContent = contentLower.includes(term);

      if (termExactTag) score += 300;
      else if (termPartialTag) score += 150;

      if (termTitle) score += 200;
      if (termContent) score += 50;

      if (termExactTag || termPartialTag || termTitle || termContent) {
        termsMatched++;
      }
    }

    if (score > 0 && termsMatched > 0) {
      if (note.is_starred) {
        score += 25;
      }
      if (
        noteTags.some((t) =>
          normalizedContextTags.includes(t.toLowerCase().replace(/^#/, ""))
        )
      ) {
        score += 15;
      }
      scored.push({ note, score });
    }
  }

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return (
        new Date(b.note.updated_at).getTime() -
        new Date(a.note.updated_at).getTime()
      );
    })
    .map((s) => s.note);
}
