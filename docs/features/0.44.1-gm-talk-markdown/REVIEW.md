---
feature: gm-talk-markdown
target_version: 0.44.1
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — v0.44.1 GM Talk Markdown Rendering

## Key Architectural Traps & Mitigations

### 1. Story Turn Isolation (`renderFormattedProse`)
- **Trap:** Modifying `renderFormattedProse` in `frontend/src/components/chat/chatHelpers.tsx` would also alter `TurnCard.tsx` and `LiveStreamingTurnCard.tsx`, causing in-character narrative prose (`1. Wait.`, `---`, dialogue quotes) to parse as Markdown assistant output.
- **Mitigation:** Leave `renderFormattedProse` untouched and introduce a dedicated `GmMarkdown` component (`frontend/src/components/chat/GmMarkdown.tsx`) mounted strictly for `role === "assistant"` and `streamingText` in `GmTalkDrawer.tsx`.

### 2. Untrusted `.zcc` Archive Security Surface (`react-markdown` + Neutralized `a`/`img`)
- **Trap:** Persisted `gm_chat_messages` can be imported via `.zcc` archives (`include_gm_chat`). Enabling HTML passthrough, clickable `javascript:`/external URLs, or remote `<img>` tracking pixels would expose XSS or outbound tracking vectors.
- **Mitigation:**
  - Never install or mount `rehype-raw`; `react-markdown@10.1.0` preserves raw HTML nodes as escaped literal text by default (verified via `renderToStaticMarkup` test assertions for `<script>` and `<world>`).
  - Override `a` to render plain `<>{children}</>`, override `img` to render `<span className="gm-md-img-fallback">`, pass `urlTransform={() => ""}`, and render GFM `input[type="checkbox"]` as `disabled readOnly`.

### 3. `white-space: pre-wrap` Inheritance Clash
- **Trap:** `05-composer-and-slash.css` applies `white-space: pre-wrap` to `.gm-message-body`. Mounting `<p>`, `<ul>`, `<h3>`, `<table>`, or `<pre>` inside a `pre-wrap` container doubles blank-line whitespace and breaks list/table indentation.
- **Mitigation:** Scope `white-space: pre-wrap` strictly to `.gm-message-card--user .gm-message-body`, leaving GM assistant `.gm-markdown` replies in normal block flow (with `remark-breaks` handling intended single-newline line breaks inside paragraphs).

### 4. `css:audit` Orphan-Class & Token Rules
- **Trap:** `frontend/scripts/audit-css.mjs` flags every `.className` selector whose token is absent from production TSX/TS/HTML files. Styling `remark-gfm`'s generated classes like `.contains-task-list` or `.task-list-item` directly would fail `css:audit`.
- **Mitigation:** Target task lists via element/attribute selectors rooted under `.gm-markdown` (`.gm-markdown li:has(> input[type="checkbox"])`, `.gm-markdown input[type="checkbox"]`), reference every custom class (`.gm-markdown`, `.gm-md-table-wrap`, `.gm-md-table`, `.gm-md-img-fallback`) explicitly in `GmMarkdown.tsx`, and use only CSS custom properties from `00-tokens.css` (zero raw hex/rgba literals, zero `!important`).

### 5. Linear-Time `O(n)` HTML Emphasis Normalization (`gmMarkdown.ts`)
- **Trap:** Backtracking regexes like `/<i>(.*?)<\/i>/gi` risk polynomial ReDoS on malformed inputs, corrupt backtick code spans/fences, emit `****` (parsed as `<hr>`) on empty `<b></b>`, break CommonMark flanking rules on `<b> text </b>`, shatter GFM table rows on `<br>`, or double newlines on `<br>\n`.
- **Mitigation:**
  - Implement `normalizeGmMarkdownInput` in `frontend/src/utils/gmMarkdown.ts` using linear line scanning for CommonMark fenced code blocks (`` ``` `` / `~~~`, including unclosed streaming fences), linear backtick-run indexing for inline code spans, and bounded `<...>` tag inspection (`<= 12` chars).
  - Move interior spaces outside `*`/`**` delimiters, drop empty tag pairs, emit `" · "` for `<br>` inside GFM table lines, suppress `<br>` immediately preceding `\n`, and leave comparisons (`Age < 30`) and non-emphasis tags (`<world>`, `<script>`) untouched.
  - Keep `frontend/src/utils/gmMarkdown.ts` free of React/component imports to comply with `frontend/.dependency-cruiser.cjs` (`no-utils-local-upward`).

### 6. Streaming Render Churn
- **Trap:** Re-parsing every settled GM message on each incoming SSE token wastes CPU and fights scroll stability.
- **Mitigation:** Wrap `GmMarkdown` in `React.memo`, memoize `normalizeGmMarkdownInput(content)` with `useMemo`, and keep `REMARK_PLUGINS`, `BLOCK_ALL_URLS`, and `GM_MARKDOWN_COMPONENTS` at module scope so settled cards do not re-render during `streamingText` updates.
