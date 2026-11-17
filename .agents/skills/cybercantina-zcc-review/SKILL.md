---
name: cybercantina-zcc-review
description: >-
  Use this skill when reviewing, validating, or polishing CyberCantina .zcc
  archives, built-in/showcase character and world JSON bundles, world media
  attachments, lore_nodes secret gating, or player-facing creator_notes.
---

# CyberCantina .zcc & Scenario Review Runbook

## 1. Isolated End-to-End .zcc Import Check
Always validate `.zcc` bundles against the real importer in a temporary directory so `unsupported_fields` warnings (e.g., deprecated `low_token_initial_message`), ID remapping, and media staging are caught:

```bash
backend/.venv/bin/python -c '
import asyncio, tempfile, sys
from pathlib import Path
sys.path.insert(0, "backend")

from app.db.repository import CantinaRepository
from app.services.import_export_service import inspect_uploaded_file, commit_staged_import
from app.schemas.import_export import ImportCommitRequest

zpath = "/path/to/bundle.zcc"

async def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp_p = Path(tmp)
        media_dir = tmp_p / "media"
        media_dir.mkdir()
        repo = CantinaRepository(db_path=tmp_p / "test.db", media_dir=media_dir)
        repo.init_db()
        user = repo.create_user(username="verifier", display_name="Verifier")
        preview = inspect_uploaded_file(repo, Path(zpath).read_bytes(), Path(zpath).name, user_id=user.id)
        print("format:", preview.format_type, "warnings:", preview.warnings)
        res = await commit_staged_import(repo, ImportCommitRequest(staged_token=preview.staged_token), user_id=user.id)
        print("commit:", res.model_dump())

asyncio.run(main())
'
```

Confirm `warnings` is empty (no lingering `unsupported_fields`), `res.success` is `True`, and `res.errors` is empty.

## 2. Media & Cross-Reference Audit
- Verify all `.webp` files in the archive decode cleanly via Pillow (`Image.open(...).verify()`).
- Extract and visually inspect character portraits/gallery and world images to verify prompt/description alignment, primary card image (`sort_order: 0`), aspect ratio consistency, and absence of unwanted corner watermarks/signatures.
- Verify `character.world_id` matches `world.id`, item `lore_id` values resolve to existing `lore_nodes`, and container/location `image_media_id` values exist in `world.media`.

## 3. Lore Gating & Secret Hygiene (`lore_scope.py`)
- **`environmental_tags` are always visible on arrival:** Never place unrevealed plot facts (e.g., `"Kira Vance's Home"`) in `environmental_tags`; place them inside a `category: "secret"` lore node instead.
- **Secret `entity_tags` matching:** `secret` lore is gated by whole-word/phrase regex matching (`_tag_matches_text`) or Clean/Critical discovery rolls (`_DISCOVERY_CHECK_STEMS`).
  - Avoid overly generic tags like `"look around"` or `"hear"` when you want a secret gated behind discovery rolls or specific topics.
  - Pair room-description visual hooks (e.g., a paper cutout on a table) with noun/topic tags (`paper`, `cutout`, `article`, `envelope`) so inspecting the prop reliably unlocks the secret.
- **Avoid duplicate lore titles** across global world lore and location lore (e.g., distinguish a global rumor title from a location-specific rumor).

## 4. `creator_notes` Authoring Guidelines
- **Plain-text & private:** `creator_notes` is federated into **Notes & Player Scratchpad** (`NotesDrawer.tsx`), rendered as plain text (avoid Markdown syntax), and never sent to the AI during turns.
- **Don't over-spoil world mechanics:** Focus on:
  1. How to interact with the character's temperament, moral code, and triggers.
  2. The turn-1 opening hook and fitting player personas.
  3. Subtle, non-spoilery pacing nudges if a player gets stuck—leaving world street-smarts, culture, and secrets to be discovered organically.
