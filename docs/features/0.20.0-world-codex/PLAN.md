---
feature: world-codex
target_version: 0.20.0
document_type: plan
status: completed
last_updated: 2026-11-18
---

# Implementation Plan & Verification Trail — `0.20.0-world-codex`

## Task Checklist

- [x] **FR-1 Backend Categories, DDL, Migration & `.zcc` Normalization:**
  - Extended `WorldLoreCategory`, `AnyLoreCategory`, `WORLD_LORE_CATEGORIES`, `normalize_lore_category`, `LoreNode._enforce_scope_invariants`, and `WizardLoreNodeLLMOutput` in [`world.py`](file:///home/diegolima/Git/cybercantina/backend/app/schemas/world.py).
  - Updated `lore_nodes` `CHECK` constraint in [`schema.sql`](file:///home/diegolima/Git/cybercantina/backend/app/db/schema.sql) and idempotent table rebuild migration in [`schema_init.py`](file:///home/diegolima/Git/cybercantina/backend/app/db/repos/schema_init.py).
  - Normalized imported `.zcc` lore categories in [`import_export_service.py`](file:///home/diegolima/Git/cybercantina/backend/app/services/import_export_service.py) and updated [`DEFAULT_WIZARD_WORLD_SYSTEM`](file:///home/diegolima/Git/cybercantina/backend/app/prompts/defaults.py).
- [x] **FR-2 – FR-4 Frontend Types & Pure Codex Logic:**
  - Mirrored `'figure'` and `'threat'` in [`world.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/types/world.ts).
  - Created [`codexHelpers.ts`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/codexHelpers.ts) with Option A section mapping, 3-tier `Title > Keywords > Content` ranking, spoiler-safe global search, cycle-safe `Locations` hierarchy, visited-only media checks, and reactive `Major Characters` list builder.
- [x] **FR-5 – FR-8 Codex UI Components, Map Focus & Campaign Inspector Wiring:**
  - Created [`CodexLocationDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLocationDetail.tsx), [`CodexCharacterDetail.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexCharacterDetail.tsx), [`CodexLoreEditor.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/CodexLoreEditor.tsx), and [`WorldCodexTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldCodexTab.tsx).
  - Added `externalFocusRequest` deep-link handler to [`SpatialTopologyView.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/SpatialTopologyView.tsx).
  - Integrated `Codex` tab, validation jump-to-entry, reactive campaign mode locations, and campaign props into [`WorldInspectorModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/world/WorldInspectorModal.tsx) and [`LiveInspector.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/LiveInspector.tsx).
  - Added `.lore-cat-badge--figure`, `.lore-cat-badge--threat`, `.lore-cat-badge--artifact`, and responsive `.codex-*` styles in [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css).
- [x] **Tests & Architecture Docs:**
  - Added backend tests in [`test_layered_lore.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_layered_lore.py), [`test_location_containers.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_location_containers.py), and [`test_import_export.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_import_export.py).
  - Added pure & SSR component tests in [`worldCodex.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/worldCodex.test.tsx).
  - Verified backend (`ruff`, `tach`, `pytest`), frontend (`arch:check`, `build`, `test`), and architecture docs (`generate_arch_docs.py --check`).
