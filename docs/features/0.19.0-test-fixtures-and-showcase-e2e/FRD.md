---
feature: test-fixtures-and-showcase-e2e
target_version: 0.19.0
document_type: frd
status: draft
last_updated: 2026-11-18
---

# Feature Requirements Document (FRD)
## Per-Test Fixture Migration & Real-Asset Showcase End-to-End Coverage

**Status:** Draft  
**Target Version:** CyberCantina v0.19.0  
**Depends On:** `0.16.0-default-showcase-seeding` (and test-harness Phase 1–2 isolation & `pytest-xdist` work)  
**Scope:**
- Backend Test Harness & Fixture Factories ([`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py), [`backend/tests/factories.py`](file:///home/diegolima/Git/cybercantina/backend/tests/factories.py) [new], [`legacy_seed.py`](file:///home/diegolima/Git/cybercantina/backend/tests/legacy_seed.py) [to retire])
- Migration of all 18 remaining test modules referencing `temp_repo` / `ensure_test_seed` / `world_neon_rust` / `char_kira_vance` / `camp_neon_rust_default` / `claim_unowned_entities`
- Dedicated Real-Asset Showcase E2E Test Suite ([`test_showcase_e2e.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_showcase_e2e.py) [new] or extension of [`test_showcase_seeding_and_public_media.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_showcase_seeding_and_public_media.py))

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Following `v0.16.0` (which replaced the old hardcoded *Sector 9: The Neon Rust* starter scenario with per-user clones of *The Green Lie* & *Kira Vance* and stopped seeding a default campaign), Phases 1 and 2 of test-suite hardening moved `ensure_test_seed` out of production code (`app/db/seed.py`) into [`legacy_seed.py`](file:///home/diegolima/Git/cybercantina/backend/tests/legacy_seed.py), isolated `settings.media_dir` and `app.dependency_overrides`, added `empty_repo`/`api_env`/`api_user_factory`, and enabled parallel execution via `pytest -n auto` (`405 passed` in `~10.35s`).

However, two structural gaps remain:

1. **Legacy Seed Coupling Across 18 Backend Test Files:**
   - **18 test files** (`~114` test functions) still rely on `temp_repo` / `ensure_test_seed` and hardcode magic IDs/strings from the retired unowned scenario (`world_neon_rust`, `char_kira_vance`, `camp_neon_rust_default`, `"Main Floor"`, `"Ripperdoc"`, `"Cooling Tunnels"`, `"Meridian"`, `"Vespera"`, `"Chimera"`), plus `repo.claim_unowned_entities(...)` calls that no longer reflect multi-tenant user ownership.
   - Each call to `temp_repo` still incurs full 5-location + 4-lore + 4-shard embedding setup (`~104ms`) even when a test only needs a single location, a 3-node graph, or one character with a single item.
   - Unrelated features (enrich, map editor, prompt presets, item inventory, personas, LTM/RRF, narrator, dice rolls) remain coupled to the shape and copy of a legacy scenario.

2. **Real-Asset Gameplay Blind Spots on *The Green Lie* & *Kira Vance*:**
   - Existing showcase tests in [`test_showcase_seeding_and_public_media.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_showcase_seeding_and_public_media.py) validate seeding, field persistence, public media serving, quota isolation, CoW forks, `.zcc` export/re-import, and profile restore—**but do not run live campaign creation or multi-turn gameplay** against the real bundled *The Green Lie* (`35` locations, `88` edges, `13` containers across depths `4 → 3 → 1`, `19` lore nodes, `3` world images) and *Kira Vance* (`paranoiac` temperament, `permanent`/`artifact` items, `8` memory shards, `unsupported_fields`).
   - Migrating all engine/spatial/branch tests solely to synthetic minimal fixtures without pairing them with real-asset E2E coverage would leave complex showcase-scale interactions (nested container LCA transitions, arrival media hierarchy, container/location `secret` lore gating, artifact lore coupling, `paranoiac` CARE trajectory, and zero-campaign start-focus launches) untested on actual user-facing starter assets.

### 1.2 Proposed Solution
1. **Composable Per-Test Fixture Builders (`backend/tests/factories.py` + `conftest.py`):**
   - Introduce small, explicit, owner-scoped builders (`make_user`, `make_world`, `make_character`, `make_campaign`, `make_linear_world`) built on `empty_repo` so every unit/integration test constructs **only** the minimal graph, items, lore, or cast it actually asserts on—with zero unowned entities (`owner_id` always set explicitly, no `claim_unowned_entities` workarounds).
2. **Staged Retirement of `legacy_seed.py` & `temp_repo`:**
   - Migrate all 18 remaining test files in 4 low-risk batches, then delete [`legacy_seed.py`](file:///home/diegolima/Git/cybercantina/backend/tests/legacy_seed.py) and remove `temp_repo` from [`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py) once zero callers remain.
3. **Paired Real-Asset Showcase E2E Suite (`test_showcase_e2e.py`):**
   - Add a focused, fast (offline-fallback / mocked-LLM, `local_hash` embeddings) end-to-end test suite exercising real user journeys directly on freshly seeded *The Green Lie* + *Kira Vance* clones.

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Behavior Regression:**
   - Migrating a test from `temp_repo` to per-test fixtures must preserve **100% of the domain assertions and edge cases** of that test (never relax assertions, skip failure paths, or weaken tenant checks).
2. **Explicit Multi-Tenant Ownership in All New/Migrated Fixtures:**
   - All entities created by `tests/factories.py` must belong to an explicit `owner_id` (`user.id`). `claim_unowned_entities` may only remain in dedicated backward-compatibility/migration tests if any explicitly test legacy claiming.
3. **Production Code Untouched (Unless a Real Bug Is Exposed):**
   - This effort targets `backend/tests/` only; production code under `backend/app/` is modified only if real-asset E2E tests uncover an actual bug (in which case it is documented and regression-tested).
4. **Fast, Deterministic, xdist-Safe Execution:**
   - Minimal per-test fixtures must create only required rows/embeddings (faster than `ensure_test_seed`), and E2E showcase tests must run offline (`allow_offline_fallback=True` or deterministic mocked `llm_client` responses) in `tmp_path` isolation under `pytest -n auto`.
5. **No Global Mutable State:**
   - Helpers in `tests/factories.py` must be pure functions operating on an explicit `repo: CantinaRepository` / `TestClient` argument; no module-level cached DB connections or shared mutable dicts.

---

## 3. Functional Requirements

### FR-1: Composable Per-Test Fixture Layer (`backend/tests/factories.py`)

Create a clean, typed helper module [`backend/tests/factories.py`](file:///home/diegolima/Git/cybercantina/backend/tests/factories.py) (avoiding duplicate setup across test files) exposing minimal, customizable builders with sensible defaults and explicit `owner_id`:

- **`seed_user(repo, *, username=..., role="user", user_id=None) -> UserProfile`**
  - Creates a persistent user via `repo.create_user(...)` with unique defaults (e.g., UUID-suffixed username when omitted) so multi-user tests compose cleanly.
- **`seed_world(repo, *, owner_id, name="Test Sector", locations=None, edges=None, containers=None, lore_nodes=None, global_rules=None, world_id=None) -> WorldRecord`**
  - Defaults to a minimal **1-location starting hub** (`"Hub Room"`, `is_starting_location=True`) unless custom `locations` / `edges` / `lore_nodes` are provided.
- **`seed_linear_world(repo, *, owner_id, names=("Hub", "Clinic", "Tunnel"), locked_indices=()) -> tuple[WorldRecord, list[LocationNode]]`**
  - Convenience builder for spatial-edge, movement, container, and branch tests needing an `A <-> B <-> C` (or `A <-> B <-> C <-> D`) connected graph in one line.
- **`seed_character(repo, *, owner_id, world_id=None, name="Test Operative", temperament="stoic", equipped=None, inventory=None, memory_shards=None, voice_anchors=None, character_id=None) -> CharacterRecord`**
  - Defaults to minimal valid `BaselinePsyche`, `voice_anchors`, and `0` memory shards (pass `memory_shards=[...]` only in RAG/LTM tests so embedding work isn't wasted when not needed).
- **`seed_campaign(repo, *, owner_id, world_id, character_id, name="Test Campaign", opening_prose="Opening scene.", start_location_id=None, campaign_id=None) -> CampaignRecord`**
  - Creates a campaign directly via `repo.create_campaign(...)` without triggering LLM placement unless `start_location_id` / placement API is specifically under test.
- **`seed_minimal_scenario(repo, *, owner_id=None, num_locations=3, with_lore=False, with_shards=False) -> ScenarioBundle`**
  - Returns a small `@dataclass` (`user`, `world`, `locations`, `character`, `campaign`) for engine/branch/clerk tests that previously relied on `camp_neon_rust_default`.
- **Optional `authed_client` factory/helper in `conftest.py`:**
  - Provides `(TestClient, CantinaRepository, UserProfile)` bound via `empty_repo` + `app.dependency_overrides[get_current_user]` (already auto-cleared by `isolate_provider_state` on teardown).

---

### FR-2: Staged Migration of the 18 Legacy-Coupled Test Modules

Migrate all 18 files currently referencing `temp_repo`, `ensure_test_seed`, `world_neon_rust`, `char_kira_vance`, `camp_neon_rust_default`, or `claim_unowned_entities` to `empty_repo` + `tests/factories.py`:

#### Batch 1 — Pure Non-Campaign / Single-Lookup Tests (Lowest Complexity)
| File | Current Dependency | Migration Target |
| :--- | :--- | :--- |
| [`test_prompts_and_presets.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_prompts_and_presets.py) | `ensure_test_seed` (1 test: `test_resolve_effective_prompts_hierarchy`) | `seed_world` + `seed_character` + `seed_campaign` on `test_repo` |
| [`test_enrich.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_enrich.py) | `ensure_test_seed` + `camp_neon_rust_default` (2 tests) | `api_env` + `api_user_factory` + `seed_minimal_scenario` |
| [`test_phase3_multi_cognition_and_phase4_prose.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_phase3_multi_cognition_and_phase4_prose.py) | `temp_repo` + `camp_neon_rust_default` (1 of 10 tests) | `empty_repo` + `seed_minimal_scenario` |
| [`test_character_attributes_and_versions.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_character_attributes_and_versions.py) | `temp_repo` (8 of 12 tests, 1 `world_neon_rust` ref, 3 `claim_unowned_entities`) | `empty_repo` + `seed_user` + `seed_world` |
| [`test_dice_rolls_and_reactions.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_dice_rolls_and_reactions.py) | `temp_repo` (2 of 18 tests, `camp_neon_rust_default` / `char_kira_vance`) | `empty_repo` + `seed_minimal_scenario` |

#### Batch 2 — World, Map, Lore, Inventory & Container Tests
| File | Current Dependency | Migration Target |
| :--- | :--- | :--- |
| [`test_spatial_edges.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_spatial_edges.py) | `temp_repo` + `camp_neon_rust_default` + 3 named locs (4 tests) | `empty_repo` + `seed_linear_world` + `seed_campaign` |
| [`test_world_starting_message.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_world_starting_message.py) | `temp_repo` + `world_neon_rust` / `char_kira_vance` (7 of 9 tests) | `empty_repo` + `seed_world` + `seed_character` |
| [`test_interactive_map_editor.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_interactive_map_editor.py) | `ensure_test_seed` + `world_neon_rust` / `char_kira_vance` (3 of 5 tests) | `api_env` + `seed_linear_world` + `seed_character` |
| [`test_item_inventory_system.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_item_inventory_system.py) | `temp_repo` + `world_neon_rust` (5 of 6 tests) | `empty_repo` + `seed_world` + `seed_character` |
| [`test_layered_lore.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_layered_lore.py) | `temp_repo` + `camp_neon_rust_default` + loc names (6 of 7 tests) | `empty_repo` + explicit lore/location builders in `factories.py` |
| [`test_location_containers.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_location_containers.py) | `temp_repo` + `char_kira_vance` / `"Main Floor"` (10 of 12 tests) | `empty_repo` + `seed_character` (reuse file's existing `_create_hierarchical_world`) |

#### Batch 3 — Affective Engine, Memory, Personas & Agents
| File | Current Dependency | Migration Target |
| :--- | :--- | :--- |
| [`test_affective_persistence_and_branches.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_affective_persistence_and_branches.py) | `temp_repo` + `camp_neon_rust_default` / `char_kira_vance` (4 of 5 tests) | `empty_repo` + `seed_minimal_scenario(temperament="stoic")` |
| [`test_affective_phase5_integration.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_affective_phase5_integration.py) | `temp_repo` + `world_neon_rust` / `camp_neon_rust_default` (5 of 6 tests) | `empty_repo` + `seed_minimal_scenario` |
| [`test_character_agents_and_arbitration.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_character_agents_and_arbitration.py) | `temp_repo` + `world_neon_rust` / `camp_neon_rust_default` (7 of 8 tests) | `empty_repo` + `seed_minimal_scenario` |
| [`test_long_term_memory_lod_rrf.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_long_term_memory_lod_rrf.py) | `temp_repo` + `camp_neon_rust_default` (5 of 8 tests) | `empty_repo` + `seed_minimal_scenario(with_lore=True, with_shards=True)` |
| [`test_narrator_meta_actor.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_narrator_meta_actor.py) | `temp_repo` + `camp_neon_rust_default` (10 of 10 tests) | `empty_repo` + `seed_minimal_scenario` |
| [`test_user_personas.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_user_personas.py) | `temp_repo` + `camp_neon_rust_default` / `world_neon_rust` (8 of 13 tests) | `empty_repo` + `seed_minimal_scenario` |

#### Batch 4 — Core Engine & Branch Suite + Final Cleanup
| File | Current Dependency | Migration Target |
| :--- | :--- | :--- |
| [`test_engine_and_branches.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_engine_and_branches.py) | `temp_repo` + `camp_neon_rust_default` + all 5 Neon Rust locs/lore/shards (27 of 30 tests) | `empty_repo` + local `_seed_engine_scenario(empty_repo)` helper (explicit 4-node graph with 1 hidden edge, 2 lore nodes, 2 shards) |
| Cleanup | `legacy_seed.py` + `temp_repo` in `conftest.py` | Delete [`legacy_seed.py`](file:///home/diegolima/Git/cybercantina/backend/tests/legacy_seed.py); remove `temp_repo` from [`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py) |

*(Note: [`test_showcase_seeding_and_public_media.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_showcase_seeding_and_public_media.py) retains its two negative assertions `w["id"] != "world_neon_rust"` / `c["id"] != "char_kira_vance"` only if desirable, or replaces them with `assert w["seed_key"] == SHOWCASE_WORLD_SEED_KEY`.)*

---

### FR-3: Paired Real-Asset End-to-End Showcase Tests (`test_showcase_e2e.py`)

To ensure minimal synthetic fixtures never mask bugs on real, complex starter content, add a dedicated E2E test module [`backend/tests/test_showcase_e2e.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_showcase_e2e.py) exercising **real seeded clones** of *The Green Lie* and *Kira Vance* (`seed_showcase_for_user` via `/api/auth/setup` or `/api/auth/register`) across full user journeys:

1. **E2E-1: Zero-Campaign Start -> World-Focused & Character-Focused Campaign Launch (`POST /api/campaigns`):**
   - Register a user -> confirm `0` campaigns and `1` *The Green Lie* + `1` *Kira Vance*.
   - Launch a **world-focused** campaign (`start_focus="world"`): verify starting placement at `Main Floor`, `Main Floor.starting_message` rendered, initial arrival description + `Main Floor` & parent container (`Sector 9: The Drain`, `Neo-Veridia`) public media URLs accessible (`GET` returns `200`).
   - Launch a **character-focused** campaign (`start_focus="character"`): verify *Kira Vance*'s `initial_message` is used at Turn 0, while `unsupported_fields["low_token_initial_message"]` never leaks into Zone 1 or Turn 0 prose.

2. **E2E-2: Multi-Turn Gameplay, Nested Container Transitions (`4 → 3 → 1`), Arrival Media & `secret` Lore Gating:**
   - Start from `Main Floor` (inside `The Neon Rust`, `depth=1` -> `Sector 9: The Drain`, `depth=3` -> `Neo-Veridia`, `depth=4`) with mocked/offline Phase 1/3/4/5 outputs.
   - Verify at `Main Floor` that container-scoped secret lore `"The Noodle-Stall Scrub"` (`The Caissons`) and location-scoped secret lore `"Ghost Signal Location"` (`Unit 4B-12`) / `"Arming the Rust-Splicers"` (`The Chop-Cathedral`) are **excluded** from Phase 2 turn context.
   - Execute a move along real edges (`Main Floor` -> `The Chop-Cathedral` in `Sector 9: The Drain`, then `Main Floor` -> `The Mid-Web` in `The Caissons`), asserting:
     - First-visit arrival metadata + media URLs are attached to the triggering turn and **suppressed** on revisit.
     - LCA container transition breadcrumbs update cleanly in Zone 4 across depth `1 → 3 → 1`.
     - Scoped `secret` lore unlocks **only** when the player is inside the matching location/container.

3. **E2E-3: Showcase Mechanics — `paranoiac` CARE Trajectory, `permanent`/`artifact` Items, Branch Swipe & Rollback:**
   - Execute turns interacting with *Kira Vance* (`temperament="paranoiac"`, `initial_worldview.benevolence = -0.8`), asserting CARE affective state evolves and persists on Turn N.
   - Verify `"Subdermal shard"` (`permanent` flag) resists removal/drop attempts in Clerk/inventory endpoints while `"Encrypted burner slate"` (`artifact` flag -> `"The Sovereign Cipher"`) injects its linked artifact lore conditionally into Phase 2 context.
   - Branch/swipe from Turn 1 and roll back (`checkout_turn_branch` / `delete_last_turn`), verifying *The Green Lie* container exploration state, CARE state, and secret lore visibility rewind cleanly without mutating the user's base seeded world/character (`seed_modified == 0`).

4. **E2E-4: Showcase `.zcc` Export -> Fresh User Re-Import -> Playable Campaign Round-Trip:**
   - Export User A's seeded *The Green Lie* + *Kira Vance* bundle via `/api/export`, import into User B (`POST /api/import/commit`), verify all `35` locations, `88` edges, `13` containers, `19` lore nodes, `3` world images, character portrait/gallery, `unsupported_fields["low_token_initial_message"]`, and `Encrypted burner slate -> The Sovereign Cipher` `lore_id` remain intact, and run a turn in a new campaign on the imported copy.

---

## 4. Non-Functional Requirements & Guardrails

1. **Performance Budget:**
   - Migrated unit/integration tests using `empty_repo` + `factories.py` must be equal to or faster than `temp_repo` (`< 40ms` DB init + minimal entity inserts, skipping unused embeddings/locations).
   - Full `pytest -n auto tests` suite (including `test_showcase_e2e.py`) should remain under **`~12s`** on the multi-core dev environment and pass cleanly under CI (`ubuntu-latest`).
2. **Isolation & xdist Safety:**
   - Every new fixture in `factories.py` and `test_showcase_e2e.py` must inherit `empty_repo` / `api_env` / `showcase_api_env` from [`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py) so `db_path`, `media_dir`, `SETTINGS_FILE_PATH`, and `app.dependency_overrides` stay strictly isolated per worker.
3. **Code Quality & Repo Gates:**
   - `cd backend && .venv/bin/ruff check app tests ../scripts/generate_arch_docs.py && .venv/bin/tach check`
   - `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
   - `cd backend && .venv/bin/pytest -n auto tests`
   - `npm --prefix frontend run arch:check && npm --prefix frontend run build && npm --prefix frontend test`

---

## 5. Acceptance Criteria & Verification Matrix

| ID | Criterion | Verification Method |
| :--- | :--- | :--- |
| **AC-1** | [`backend/tests/factories.py`](file:///home/diegolima/Git/cybercantina/backend/tests/factories.py) provides clean, owner-scoped builders (`seed_user`, `seed_world`, `seed_linear_world`, `seed_character`, `seed_campaign`, `seed_minimal_scenario`) with zero `owner_id=None` / `claim_unowned_entities` reliance. | Code review + `ruff check` |
| **AC-2** | All 18 remaining legacy-seeded test files (Batches 1–4) pass using `empty_repo` + per-test fixtures with **zero** references to `legacy_seed`, `ensure_test_seed`, `temp_repo`, `world_neon_rust`, `char_kira_vance`, or `camp_neon_rust_default`. | `rg` audit + `pytest -n auto tests` |
| **AC-3** | [`legacy_seed.py`](file:///home/diegolima/Git/cybercantina/backend/tests/legacy_seed.py) and `temp_repo` in [`conftest.py`](file:///home/diegolima/Git/cybercantina/backend/tests/conftest.py) are removed. | File removal + `pytest -n auto tests` |
| **AC-4** | [`test_showcase_e2e.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_showcase_e2e.py) passes E2E-1 through E2E-4 against real seeded clones of *The Green Lie* & *Kira Vance* (start-focus modes, nested `4 → 3 → 1` container traversal, arrival media hierarchy, scoped `secret` lore gating, `permanent`/`artifact` items, `paranoiac` CARE + branch rollback, and `.zcc` export->import->play). | `pytest -n auto tests/test_showcase_e2e.py` |
| **AC-5** | Full backend (`ruff`, `tach`, `pytest -n auto`), architecture doc (`generate_arch_docs.py --check`), and frontend (`arch:check`, `build`, `test`) gates pass cleanly with no warnings regression. | Full CLI verification |

---

## 6. Execution Order & Rollout Notes

1. Implement [`backend/tests/factories.py`](file:///home/diegolima/Git/cybercantina/backend/tests/factories.py) and add [`test_showcase_e2e.py`](file:///home/diegolima/Git/cybercantina/backend/tests/test_showcase_e2e.py) **first** so real-asset E2E coverage is in place before refactoring legacy tests.
2. Migrate Batches 1 → 2 → 3 → 4 incrementally, running `pytest -n auto tests` after each batch.
3. Delete [`legacy_seed.py`](file:///home/diegolima/Git/cybercantina/backend/tests/legacy_seed.py) and `temp_repo` once zero references remain.
