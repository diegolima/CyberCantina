---
feature: gm-talk-markdown
target_version: 0.44.1
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — v0.44.1 GM Talk Markdown Rendering (`GmMarkdown`)

## 1. Overview & Motivation

CyberCantina's out-of-character GM assistant (**Neuromancer**, `GM Talk`) is explicitly instructed in `DEFAULT_GM_TALK_SYSTEM` (`backend/app/prompts/defaults.py`) to keep answers concise, clear, and well-structured using **lightweight Markdown**. CyberCantina's own deterministic backend messages (`build_offline_gm_reply` in `backend/app/engine/gm_talk.py` and the Codex proposal confirmation fallback in `backend/app/routers/campaign_routes/gm_routes.py`) also emit Markdown (`**bold**`, `- ` lists, `_italics_`), and the original v0.32.0 FRD specified Markdown rendering.

Currently, `GmTalkDrawer.tsx` delegates both persisted and streaming GM assistant replies to `renderFormattedProse` (`frontend/src/components/chat/chatHelpers.tsx`), which splits only on `/(\*[^*]+\*)/g`. That breaks Markdown in practice:
- `**bold**` matches inner `*bold*` and renders literal `*` + *bold* + `*`.
- `* item 1\n* item 2` spans newlines and eats list markers.
- Headings (`#`), `- ` / `1.` lists, `` `code` ``, fenced code blocks, blockquotes, strikethrough, GFM tables, and `_italics_` render as raw ASCII syntax.

This feature delivers dedicated, secure, live-streaming Markdown rendering for **GM Talk assistant replies only** without disturbing Story Turn prose or modifying backend behavior.

---

## 2. Agreed Product Decisions

### 2.1 Scope & Isolation
- **GM Talk assistant replies only:** Render Markdown for persisted `role === "assistant"` messages and live `streamingText` in `frontend/src/components/chat/GmTalkDrawer.tsx`.
- **User OOC messages stay plain text:** Keep user-authored messages in `.gm-message-card--user` as literal `white-space: pre-wrap` text so `@mentions`, filenames, and asterisks are never unexpectedly parsed.
- **Story Turn prose untouched:** Keep `renderFormattedProse` in `chatHelpers.tsx` (used by `TurnCard.tsx` and `LiveStreamingTurnCard.tsx`) unchanged so in-character narrative prose preserves `*actions*` and `"dialogue"` semantics.
- **Raw `Copy` preserved:** The message-level `Copy` button continues copying raw `msg.content` Markdown.

### 2.2 Parser Stack & Supported Elements
- **Stack:** `react-markdown` (`^10.1.0`) + `remark-gfm` (`^4.0.1`) + `remark-breaks` (`^4.0.0`), rendering strictly to React elements (zero `dangerouslySetInnerHTML`, no `rehype-raw`).
- **Supported elements:** Paragraphs, compact clamped headings (`h1`–`h6`), **bold**, *italic* (CommonMark intraword `snake_case` underscore safe, e.g., `unlock_lore`, `propose_world_lore_entry`), ~~strikethrough~~, ordered & unordered lists (nested), read-only GFM task list checkboxes, blockquotes, horizontal rules (`---`), inline `` `code` ``, minimal monospace fenced `<pre><code>` blocks (no extra per-block copy button or syntax highlighter), and GFM tables inside horizontal scroll containers.
- **Line breaks:** `remark-breaks` preserves single newlines inside paragraphs as `<br />`, matching stacked LLM output (`**Location:** ...\n**Status:** ...`) and existing persisted GM messages.

### 2.3 Untrusted `.zcc` Security & Element Policy
Because GM chat history can be imported from external `.zcc` archives (`include_gm_chat`):
- **Raw HTML escaped as literal text:** `rehype-raw` is never used; comparisons (`Age < 30`) and echoed XML tags (`<world>`, `<script>`) remain visible literal text and never execute or mount DOM elements.
- **Images disabled (`![]()`):** Render muted inline fallback text (`[Image: alt]` or `[Image]`) instead of `<img>`, preventing outbound tracking requests and drawer layout blowouts.
- **Links disabled (`[]()` and GFM autolinks):** Render link label/text as plain non-clickable text (zero `<a>` tags, with `urlTransform={() => ""}` as defense-in-depth).

### 2.4 Frontend-Only Inline HTML Emphasis Normalization
- Purely frontend change (no backend prompt, SSE stream, or SQLite changes).
- A deterministic linear-time (`O(n)`, ReDoS-safe) preprocessor (`normalizeGmMarkdownInput` in `frontend/src/utils/gmMarkdown.ts`) converts stray local-model inline HTML formatting tags (`<i>`/`<em>` → `*`, `<b>`/`<strong>` → `**`, `<br>`/`<br/>` → `\n` or `" · "` inside GFM table rows) strictly **outside** fenced code blocks and inline code spans, retroactively fixing persisted GM messages too.

### 2.5 Streaming Performance & Compact Drawer Ergonomics
- **Live streaming + memoized history:** Render Markdown live on every SSE token chunk; wrap `GmMarkdown` in `React.memo` (with module-level plugin/component references) so settled historical messages skip re-parsing during streaming.
- **Compact drawer layout:** Scope `white-space: pre-wrap` strictly to `.gm-message-card--user .gm-message-body`, style `.gm-markdown` in normal block flow with compact clamped headings and `overflow-x: auto` table/code wrappers using semantic tokens from `00-tokens.css` (and responsive tweaks in `15-responsive.css`).

---

## 3. Acceptance Criteria
- [x] `GmMarkdown` renders headings, bold, italic, strikethrough, nested lists, disabled task checkboxes, blockquotes, hr, inline code, fenced code blocks, GFM tables, intraword `snake_case` identifiers, and single-newline breaks cleanly in GM Talk assistant replies.
- [x] User OOC bubbles remain literal plain text (`white-space: pre-wrap`) and Story Turn `renderFormattedProse` remains untouched.
- [x] Raw `<script>` / `<world>` HTML tags render as escaped literal text; Markdown images render `.gm-md-img-fallback` with zero `<img>` tags; Markdown links and GFM autolinks render plain text with zero `<a>` tags.
- [x] Client-side preprocessor converts stray `<i>`/`<em>`/`<b>`/`<strong>`/`<br>` tags outside code spans/blocks in `O(n)` linear time without corrupting code blocks, table rows, comparisons, or empty tags.
- [x] All frontend checks (`arch:check`, `css:audit`, `build`, `test`), backend checks (`ruff`, `tach`, `pytest`), architecture docs (`generate_arch_docs.py --check`), and wiki docs (`../cybercantina-wiki`) pass.
