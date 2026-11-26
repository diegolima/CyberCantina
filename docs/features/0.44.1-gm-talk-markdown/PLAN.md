---
feature: gm-talk-markdown
target_version: 0.44.1
document_type: plan
status: completed
last_updated: 2026-11-26
---

# Implementation Plan — v0.44.1 GM Talk Markdown Rendering

## Step 1: Feature Spec Package
- [x] Author `FRD.md` (`docs/features/0.44.1-gm-talk-markdown/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/0.44.1-gm-talk-markdown/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/0.44.1-gm-talk-markdown/PLAN.md`)

## Step 2: Frontend Markdown Dependencies
- [x] Install `react-markdown`, `remark-gfm`, and `remark-breaks` in `frontend/package.json`

## Step 3: Linear-Time Preprocessor (`frontend/src/utils/gmMarkdown.ts`)
- [x] Implement `normalizeGmMarkdownInput` with CommonMark fence protection, inline code span indexing, table-safe `<br>` normalization, flanking-safe `<i>`/`<em>`/`<b>`/`<strong>` conversion, and empty-tag cleanup

## Step 4: `GmMarkdown` Component (`frontend/src/components/chat/GmMarkdown.tsx`)
- [x] Build `React.memo`-wrapped `GmMarkdown` with `remark-gfm`, `remark-breaks`, `urlTransform={() => ""}`, plain-text links, image fallback spans, horizontal-scroll tables, and read-only checkboxes
- [x] Verify default `react-markdown@10.1.0` escaping behavior on `<world>` and `<script>` via `renderToStaticMarkup`

## Step 5: Wire Into `GmTalkDrawer.tsx`
- [x] Replace `renderFormattedProse` calls in `GmTalkDrawer.tsx` (persisted assistant replies + live `streamingText`) with `<GmMarkdown />` while keeping user bubbles and Story Turn prose untouched

## Step 6: Drawer Markdown Styles
- [x] Scope `white-space: pre-wrap` to `.gm-message-card--user .gm-message-body` and add `.gm-markdown` / `.gm-md-*` token-based rules in `frontend/src/styles/05-composer-and-slash.css`
- [x] Add `<= 620px` mobile spacing tweaks in `frontend/src/styles/15-responsive.css`

## Step 7: Unit & Component Tests
- [x] Create `frontend/src/utils/__tests__/gmMarkdown.test.ts`
- [x] Create `frontend/src/components/__tests__/gmMarkdown.test.tsx`
- [x] Extend `frontend/src/components/__tests__/gmTalkUi.test.tsx`

## Step 8: Documentation & Full Verification
- [x] Update `../cybercantina-wiki/Playing-Directing-and-Mechanics.md` and check `git -C ../cybercantina-wiki diff`
- [x] Regenerate and verify architecture docs (`scripts/generate_arch_docs.py --check`)
- [x] Mark spec documents `completed` with all checkboxes checked
- [x] Run frontend (`arch:check`, `css:audit`, `build`, `test`) and backend (`ruff`, `tach`, `pytest`) suites
