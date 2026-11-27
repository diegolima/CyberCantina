---
feature: green-lie-seed-v3
target_version: 0.52.5
document_type: plan
status: completed
last_updated: 2026-11-28
---

# Implementation Plan — Upgraded *The Green Lie* Showcase Seed & Full Spatial Seeder Parity

## Step 1: Export & Feature Spec Package
- [x] Create isolated worktree `.worktrees/green-lie-seed-v3` on branch `feat/green-lie-seed-v3`
- [x] Export local `The Green Lie` (`world_b07c520ab5`) + `Yulia Halim` to `.zcc` and normalized `world.json` candidate, and verify isolated `.zcc` import round-trip
- [x] Author `FRD.md` (`docs/features/TBD-green-lie-seed-v3/FRD.md`)
- [x] Author `REVIEW.md` (`docs/features/TBD-green-lie-seed-v3/REVIEW.md`)
- [x] Author `PLAN.md` (`docs/features/TBD-green-lie-seed-v3/PLAN.md`)
- [x] Obtain explicit user approval before modifying production code

## Step 2: Update Showcase World Bundle
- [x] Replace `backend/app/db/showcase_data/the_green_lie/world.json` with the normalized upgraded world export:
  - Canonical unprefixed media IDs/URLs (`wmed_28416ce9b1`, `wmed_7149de5689`, `wmed_d8d34909a5`, `vid_neo_veridia`) with video dimensions/duration preserved
  - Canonical `"The Sovereign Cipher"` lore ID (`lore_ced32a7021`) matching `character.json`
  - Validate with `WorldRecord.model_validate(...)`

## Step 3: Upgrade `backend/app/db/seed.py` for Full Spatial Parity
- [x] Update `_seed_green_lie_world_for_user` in `backend/app/db/seed.py`:
  - Persist remapped `anchor_location_id` on `location_nodes` (validated outside own container subtree)
  - Persist `location_props` rows after world `lore_nodes` are mapped into `id_remap` (fresh `prop_<hex>` IDs, remapped `lore_id`, preserved `is_hidden`/`flags`/`note`/`sort_order`)
  - Persist `distance_mode` and `is_vertical` on `location_edges` using `extract_edge_consistency_fields(edge)`

## Step 4: Tests & Verification Gates
- [x] Update `backend/tests/test_showcase_seeding_and_public_media.py`:
  - Update location count (`35` → `37`) and global lore count (`14` → `15`, including `Aegis Security Patrols` threat lore)
  - Assert seeded `anchor_location_id` (3 anchors), `props` (2 props with hidden/visible states), `is_vertical` (22 directed edges), `distance_mode`, and rich link metadata (`travel_mode`, `speed_modifier`, `obstacles`)
  - Verify `.zcc` export → isolated re-import preserves all new fields with zero errors
- [x] Update `backend/tests/test_spatial_edges.py`:
  - Update `test_green_lie_showcase_seed_uses_metric_distances` for the realistic interior/vertical distances (`>= 1m`) and verify vertical transitions
- [x] Verify `analyzeSpatialConsistency` reports **0 diagnostics** across all scopes on the freshly seeded world
- [x] Run required checks:
  - `cd backend && .venv/bin/ruff check app tests && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests`
  - `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- [x] Note on `../cybercantina-wiki`: No user-facing mechanics or UI controls change; no wiki updates required.
