/**
 * Linear-time (O(n), ReDoS-safe) Markdown preprocessor for GM Talk assistant replies.
 *
 * Normalizes stray inline HTML formatting tags emitted by smaller local models
 * (`<i>`/`<em>`, `<b>`/`<strong>`, `<br>`/`<br/>`) outside fenced code blocks and
 * inline code spans while leaving raw HTML tags (`<world>`, `<script>`),
 * comparisons (`Age < 30`), and Markdown syntax intact.
 */

interface FenceSpec {
  char: "`" | "~";
  length: number;
}

function parseFenceOpener(line: string): FenceSpec | null {
  let spaces = 0;
  while (spaces < line.length && spaces < 4 && line[spaces] === " ") {
    spaces++;
  }
  if (spaces > 3 || spaces >= line.length) {
    return null;
  }
  const ch = line[spaces];
  if (ch !== "`" && ch !== "~") {
    return null;
  }
  let len = 0;
  while (spaces + len < line.length && line[spaces + len] === ch) {
    len++;
  }
  if (len < 3) {
    return null;
  }
  // CommonMark: backtick fence info strings cannot contain backtick characters.
  if (ch === "`" && line.indexOf("`", spaces + len) !== -1) {
    return null;
  }
  return { char: ch, length: len };
}

function isFenceCloser(line: string, fence: FenceSpec): boolean {
  let spaces = 0;
  while (spaces < line.length && spaces < 4 && line[spaces] === " ") {
    spaces++;
  }
  if (spaces > 3 || spaces >= line.length) {
    return false;
  }
  let len = 0;
  while (spaces + len < line.length && line[spaces + len] === fence.char) {
    len++;
  }
  if (len < fence.length) {
    return false;
  }
  for (let i = spaces + len; i < line.length; i++) {
    if (line[i] !== " " && line[i] !== "\t") {
      return false;
    }
  }
  return true;
}

function isTableDelimiterCell(rawCell: string): boolean {
  const cell = rawCell.trim();
  if (!cell) return false;
  let start = 0;
  let end = cell.length;
  if (cell[start] === ":") start++;
  if (end > start && cell[end - 1] === ":") end--;
  if (end <= start) return false;
  for (let i = start; i < end; i++) {
    if (cell[i] !== "-") {
      return false;
    }
  }
  return true;
}

function isTableDelimiterLine(line: string): boolean {
  if (!line.includes("|")) return false;
  let trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  if (!trimmed) return false;
  const cells = trimmed.split("|");
  return cells.length >= 1 && cells.every(isTableDelimiterCell);
}

function computeTableLines(lines: string[]): boolean[] {
  const isTable = new Array<boolean>(lines.length).fill(false);
  for (let r = 0; r + 1 < lines.length; r++) {
    if (lines[r].includes("|") && isTableDelimiterLine(lines[r + 1])) {
      isTable[r] = true;
      isTable[r + 1] = true;
      let k = r + 2;
      while (k < lines.length && lines[k].trim() !== "" && lines[k].includes("|")) {
        isTable[k] = true;
        k++;
      }
      r = k - 1;
    }
  }
  return isTable;
}

function readBoundedTagInner(text: string, ltIndex: number): { inner: string; gtIndex: number } | null {
  const limit = Math.min(text.length, ltIndex + 17);
  for (let j = ltIndex + 1; j < limit; j++) {
    const ch = text[j];
    if (ch === "<" || ch === "\n") {
      return null;
    }
    if (ch === ">") {
      return {
        inner: text.slice(ltIndex + 1, j).trim().toLowerCase(),
        gtIndex: j,
      };
    }
  }
  return null;
}

function isBrTagInner(inner: string): boolean {
  if (inner === "br" || inner === "br/") return true;
  if (!inner.startsWith("br")) return false;
  return inner.slice(2).trim() === "/";
}

function emphasisMarkerForTag(inner: string): { marker: "*" | "**"; closing: boolean; tagName: string } | null {
  switch (inner) {
    case "i":
    case "em":
      return { marker: "*", closing: false, tagName: inner };
    case "/i":
    case "/em":
      return { marker: "*", closing: true, tagName: inner.slice(1) };
    case "b":
    case "strong":
      return { marker: "**", closing: false, tagName: inner };
    case "/b":
    case "/strong":
      return { marker: "**", closing: true, tagName: inner.slice(1) };
    default:
      return null;
  }
}

function normalizeNonFenceChunk(chunk: string, followedByLineBreak: boolean): string {
  if (!chunk) return "";

  const isTableLine = computeTableLines(chunk.split("\n"));

  // Pre-index inline backtick runs by length for O(n) code-span matching.
  const runsByLen = new Map<number, number[]>();
  for (let p = 0; p < chunk.length; ) {
    if (chunk[p] === "`") {
      let k = 1;
      while (p + k < chunk.length && chunk[p + k] === "`") {
        k++;
      }
      let arr = runsByLen.get(k);
      if (!arr) {
        arr = [];
        runsByLen.set(k, arr);
      }
      arr.push(p);
      p += k;
    } else {
      p++;
    }
  }
  const cursorByLen = new Map<number, number>();

  const out: string[] = [];
  let lineIdx = 0;

  for (let i = 0; i < chunk.length; ) {
    const ch = chunk[i];

    if (ch === "`") {
      let k = 1;
      while (i + k < chunk.length && chunk[i + k] === "`") {
        k++;
      }
      const arr = runsByLen.get(k)!;
      let cursor = cursorByLen.get(k) ?? 0;
      while (cursor < arr.length && arr[cursor] <= i) {
        cursor++;
      }
      cursorByLen.set(k, cursor);

      if (cursor < arr.length) {
        const closePos = arr[cursor];
        const blankIdx = chunk.indexOf("\n\n", i + k);
        if (blankIdx === -1 || blankIdx >= closePos) {
          cursorByLen.set(k, cursor + 1);
          const span = chunk.slice(i, closePos + k);
          for (let s = 0; s < span.length; s++) {
            if (span[s] === "\n") lineIdx++;
          }
          out.push(span);
          i = closePos + k;
          continue;
        }
      }

      out.push(chunk.slice(i, i + k));
      i += k;
      continue;
    }

    if (ch === "<") {
      const parsed = readBoundedTagInner(chunk, i);
      if (parsed) {
        const { inner, gtIndex } = parsed;

        if (isBrTagInner(inner)) {
          if (isTableLine[lineIdx]) {
            out.push(" · ");
          } else if (
            chunk[gtIndex + 1] === "\n" ||
            (gtIndex + 1 === chunk.length && followedByLineBreak)
          ) {
            // Adjacent newline already provides the break; avoid doubling into a paragraph gap.
          } else {
            out.push("\n");
          }
          i = gtIndex + 1;
          continue;
        }

        const emph = emphasisMarkerForTag(inner);
        if (emph) {
          if (!emph.closing) {
            let wsEnd = gtIndex + 1;
            while (wsEnd < chunk.length && (chunk[wsEnd] === " " || chunk[wsEnd] === "\t")) {
              wsEnd++;
            }
            // Drop empty emphasis pairs (e.g., <b></b> or <b> </b>) so **** never turns into <hr>.
            if (wsEnd < chunk.length && chunk[wsEnd] === "<") {
              const closeCheck = readBoundedTagInner(chunk, wsEnd);
              if (closeCheck && closeCheck.inner === `/${emph.tagName}`) {
                if (wsEnd > gtIndex + 1) {
                  out.push(chunk.slice(gtIndex + 1, wsEnd));
                }
                i = closeCheck.gtIndex + 1;
                continue;
              }
            }
            if (wsEnd > gtIndex + 1) {
              out.push(chunk.slice(gtIndex + 1, wsEnd));
            }
            out.push(emph.marker);
            i = wsEnd;
            continue;
          }

          // Closing emphasis tag: move trailing inline spaces outside the closing marker.
          const poppedSpaces: string[] = [];
          while (out.length > 0) {
            const tail = out[out.length - 1];
            if (tail === " " || tail === "\t") {
              poppedSpaces.push(out.pop()!);
            } else if (tail.length > 1 && (tail.endsWith(" ") || tail.endsWith("\t"))) {
              let cut = tail.length;
              while (cut > 0 && (tail[cut - 1] === " " || tail[cut - 1] === "\t")) {
                cut--;
              }
              out[out.length - 1] = tail.slice(0, cut);
              poppedSpaces.push(tail.slice(cut));
              if (cut > 0) break;
            } else {
              break;
            }
          }
          out.push(emph.marker);
          for (let p = poppedSpaces.length - 1; p >= 0; p--) {
            out.push(poppedSpaces[p]);
          }
          i = gtIndex + 1;
          continue;
        }
      }
    }

    if (ch === "\n") {
      lineIdx++;
    }
    out.push(ch);
    i++;
  }

  return out.join("");
}

/**
 * Normalize stray inline HTML formatting tags (`<i>`, `<em>`, `<b>`, `<strong>`, `<br>`)
 * into safe Markdown equivalents outside fenced code blocks and inline code spans.
 */
export function normalizeGmMarkdownInput(raw: string): string {
  if (!raw) return "";
  const normalized = raw.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  const segments: string[] = [];
  let plainLines: string[] = [];
  let activeFence: FenceSpec | null = null;
  let fenceLines: string[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (activeFence !== null) {
      fenceLines.push(line);
      if (isFenceCloser(line, activeFence)) {
        segments.push(fenceLines.join("\n"));
        fenceLines = [];
        activeFence = null;
      }
      continue;
    }

    const opener = parseFenceOpener(line);
    if (opener) {
      if (plainLines.length > 0) {
        segments.push(normalizeNonFenceChunk(plainLines.join("\n"), true));
        plainLines = [];
      }
      activeFence = opener;
      fenceLines = [line];
    } else {
      plainLines.push(line);
    }
  }

  if (activeFence !== null && fenceLines.length > 0) {
    segments.push(fenceLines.join("\n"));
  } else if (plainLines.length > 0) {
    segments.push(normalizeNonFenceChunk(plainLines.join("\n"), false));
  }

  return segments.join("\n");
}
