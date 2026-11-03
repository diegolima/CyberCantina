import {
  CharacterChoiceOption,
  CharacterChoiceSet,
  ChoiceGate,
  DEFAULT_GATE_DC,
  MAX_CHOICE_LABEL_LENGTH,
  MAX_CHOICE_OPTIONS,
} from "../types";

export interface ParsedChoiceCommand {
  matchedCharacter: { id: string; name: string } | null;
  choiceSet: CharacterChoiceSet;
  unrecognizedCharacterQuery?: string;
}

export function isChoiceSlashCommand(text: string): boolean {
  return /^\/choices?(\s|$)/i.test(text.trim());
}

const GATE_TAG_REGEX = /@(critfail|botch|crit(?:ical)?|success|pass|fail(?:ure)?|any)\b/i;

function parseGateTag(segment: string): { label: string; gate: ChoiceGate } {
  let gate: ChoiceGate = "any";
  let label = segment;

  const match = segment.match(GATE_TAG_REGEX);
  if (match) {
    const tag = match[1].toLowerCase();
    if (tag === "critfail" || tag === "botch") {
      gate = "critical_failure";
    } else if (tag === "crit" || tag === "critical") {
      gate = "critical_success";
    } else if (tag === "success" || tag === "pass") {
      gate = "success_plus";
    } else if (tag === "fail" || tag === "failure") {
      gate = "failure_minus";
    } else {
      gate = "any";
    }
    label = segment.replace(GATE_TAG_REGEX, "").trim();
  }

  // Clean up any stray trailing/leading punctuation
  label = label.replace(/\s+/g, " ").trim();
  return { label, gate };
}

export function parseChoiceSlashCommand(
  rawText: string,
  presentCharacters: Array<{ id: string; name: string }>
): ParsedChoiceCommand | null {
  const trimmed = rawText.trim();
  if (!isChoiceSlashCommand(trimmed)) {
    return null;
  }

  // Remove leading /choice or /choices
  const body = trimmed.replace(/^\/choices?\s*/i, "").trim();

  let preamble = "";
  let optionsPart = "";

  const colonIdx = body.indexOf(":");
  if (colonIdx !== -1) {
    preamble = body.slice(0, colonIdx).trim();
    optionsPart = body.slice(colonIdx + 1).trim();
  } else {
    // If no colon, maybe entire body is options separated by |
    if (body.includes("|")) {
      preamble = "";
      optionsPart = body;
    } else {
      // Just a character name or prompt with no choices
      preamble = body;
      optionsPart = "";
    }
  }

  // Parse optional DC in preamble: e.g. "Soren (DC 15)" or "(DC 14)" or "DC 14"
  let gateDC = DEFAULT_GATE_DC;
  let cleanPreamble = preamble;

  const dcMatch = cleanPreamble.match(/\(?\bDC\s*:?\s*(\d+)\b\)?/i);
  if (dcMatch) {
    const parsedDC = parseInt(dcMatch[1], 10);
    if (!isNaN(parsedDC) && parsedDC >= 1 && parsedDC <= 30) {
      gateDC = parsedDC;
    }
    cleanPreamble = cleanPreamble.replace(dcMatch[0], "").trim();
  }

  cleanPreamble = cleanPreamble.replace(/^["']|["']$/g, "").trim();

  // Match character
  let matchedChar: { id: string; name: string } | null = null;
  let unrecognized: string | undefined = undefined;

  if (cleanPreamble) {
    const q = cleanPreamble.toLowerCase();
    // 1. Exact match
    matchedChar =
      presentCharacters.find((c) => c.name.toLowerCase() === q) || null;

    // 2. Starts with query
    if (!matchedChar) {
      matchedChar =
        presentCharacters.find((c) => c.name.toLowerCase().startsWith(q)) ||
        null;
    }

    // 3. Contains query
    if (!matchedChar) {
      matchedChar =
        presentCharacters.find((c) => c.name.toLowerCase().includes(q)) ||
        null;
    }

    if (!matchedChar) {
      unrecognized = cleanPreamble;
      // Fallback to first present character if available
      matchedChar = presentCharacters[0] || null;
    }
  } else {
    // No character specified in preamble -> default to active / first present character
    matchedChar = presentCharacters[0] || null;
  }

  // Parse options
  const rawSegments = optionsPart
    ? optionsPart.split("|")
    : [];

  const options: CharacterChoiceOption[] = [];
  let optIndex = 1;

  for (const seg of rawSegments) {
    const trimmedSeg = seg.trim();
    if (!trimmedSeg) continue;
    const { label, gate } = parseGateTag(trimmedSeg);
    if (!label) continue;
    options.push({
      id: `opt_${Date.now()}_${optIndex++}`,
      label: label.slice(0, MAX_CHOICE_LABEL_LENGTH),
      gate,
    });
    if (options.length >= MAX_CHOICE_OPTIONS) {
      break;
    }
  }

  const charId = matchedChar?.id || "unknown";

  return {
    matchedCharacter: matchedChar,
    choiceSet: {
      character_id: charId,
      options,
      gate_difficulty_class: gateDC,
    },
    unrecognizedCharacterQuery: unrecognized,
  };
}
