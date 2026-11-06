import { CharacterRecord, CharacterWhisper, DecomposedUserMessage, MentionTargetScope } from "../types";

const SMART_DOUBLE_QUOTES = ["“", "”", "„", "‟", "«", "»"];
const SMART_SINGLE_QUOTES = ["‘", "’", "‚", "‛"];
const MENTION_LINE_RE = /^@([^:\n]+?)\s*:\s*(.*)$/;

export function normalizeQuotes(text: string): string {
  if (!text) return "";
  let res = text;
  for (const q of SMART_DOUBLE_QUOTES) {
    res = res.replaceAll(q, '"');
  }
  for (const q of SMART_SINGLE_QUOTES) {
    res = res.replaceAll(q, "'");
  }
  return res;
}

export function parseWhisperContent(content: string): { speech: string[]; sensory: string[] } {
  const normalized = normalizeQuotes(content).trim();
  if (!normalized) {
    return { speech: [], sensory: [] };
  }

  const speeches: string[] = [];
  const sensory: string[] = [];

  const parts = normalized.split('"');
  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx].trim();
    if (!part) continue;
    if (idx % 2 === 1) {
      speeches.push(part);
    } else {
      const cleaned = part.replace(/^[,;:\s]+|[,;:\s]+$/g, "").trim();
      if (cleaned) {
        sensory.push(cleaned);
      }
    }
  }

  return { speech: speeches, sensory };
}

export function decomposeClientUserMessage(
  rawText: string,
  characters: CharacterRecord[],
  presentCharacterIds?: string[]
): DecomposedUserMessage {
  if (!rawText || !rawText.trim()) {
    return {
      raw_message: rawText || "",
      public_text: "",
      whispers: [],
      whispers_by_character_id: {},
      remote_whispers: [],
    };
  }

  const charLookup: Record<string, CharacterRecord> = {};
  for (const c of characters) {
    charLookup[c.name.trim().toLowerCase()] = c;
  }

  const presentSet = new Set(presentCharacterIds ?? characters.map((c) => c.id));
  const publicLines: string[] = [];
  const whispersDict: Record<string, CharacterWhisper> = {};
  const order: string[] = [];

  for (const rawLine of rawText.split("\n")) {
    const line = normalizeQuotes(rawLine);
    const match = line.match(MENTION_LINE_RE);
    if (match) {
      const candName = match[1].trim().toLowerCase();
      const targetChar = charLookup[candName];
      if (targetChar) {
        const content = match[2];
        const { speech, sensory } = parseWhisperContent(content);
        const scope: MentionTargetScope = presentSet.has(targetChar.id) ? "local" : "remote";

        if (!whispersDict[targetChar.id]) {
          whispersDict[targetChar.id] = {
            character_id: targetChar.id,
            character_name: targetChar.name,
            target_scope: scope,
            raw_lines: [rawLine],
            speech_parts: speech,
            sensory_parts: sensory,
          };
          order.push(targetChar.id);
        } else {
          const existing = whispersDict[targetChar.id];
          existing.raw_lines.push(rawLine);
          existing.speech_parts.push(...speech);
          existing.sensory_parts.push(...sensory);
        }
        continue;
      }
    }
    publicLines.push(rawLine);
  }

  const whispers = order.map((id) => whispersDict[id]);
  const remoteWhispers = whispers.filter((w) => w.target_scope === "remote");

  return {
    raw_message: rawText,
    public_text: publicLines.join("\n").trim(),
    whispers,
    whispers_by_character_id: whispersDict,
    remote_whispers: remoteWhispers,
  };
}
