export interface ParsedModelName {
  vendor?: string;
  displayName: string;
  tag?: string;
  raw: string;
}

/**
 * Parses a raw model identifier (e.g., "meta-llama/llama-3.3-70b-instruct:free" or "qwen2.5:7b")
 * into a clean display name and an optional secondary tag/quant badge.
 *
 * Rules:
 * - Vendor prefix (e.g. "meta-llama/") is extracted into `vendor` and removed from `displayName`.
 * - Generic ":latest" tags are discarded.
 * - Specific parameter size/quantization tags (e.g. ":7b", ":32b", ":free", ":q4_K_M") are extracted into `tag`.
 */
export function parseModelName(rawModel?: string | null): ParsedModelName {
  if (!rawModel || !rawModel.trim()) {
    return {
      displayName: "None selected",
      raw: "",
    };
  }

  let text = rawModel.trim();
  let vendor: string | undefined;

  // 1. Extract vendor prefix if present (e.g., "meta-llama/...")
  const slashIdx = text.indexOf("/");
  if (slashIdx !== -1) {
    vendor = text.slice(0, slashIdx).trim();
    text = text.slice(slashIdx + 1).trim();
  }

  // 2. Extract tag / quantization if present (e.g., ":7b", ":latest", ":free")
  const colonIdx = text.lastIndexOf(":");
  let tag: string | undefined;
  if (colonIdx !== -1) {
    const rawTag = text.slice(colonIdx + 1).trim();
    text = text.slice(0, colonIdx).trim();
    if (rawTag.toLowerCase() !== "latest") {
      tag = rawTag;
    }
  }

  return {
    vendor: vendor || undefined,
    displayName: text || rawModel,
    tag: tag || undefined,
    raw: rawModel,
  };
}

export function roleDisplayMeta(role: "actor" | "clerk" | "vectors" | "embedding"): {
  title: string;
  subtitle: string;
  accent: string;
} {
  switch (role) {
    case "actor":
      return {
        title: "Primary",
        subtitle: "Phase 3 Prose & Cognition",
        accent: "var(--accent-amber)",
      };
    case "clerk":
      return {
        title: "Auxiliary",
        subtitle: "Phase 1 & 4 Pre-turn Clerk",
        accent: "var(--accent-cyan)",
      };
    case "vectors":
    case "embedding":
      return {
        title: "Vectors",
        subtitle: "Semantic Memory & Recall",
        accent: "var(--accent-emerald)",
      };
  }
}
