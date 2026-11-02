"""Backward-compatibility shim for Phase 4 Clerk.

In the canonical 5-phase pipeline:
- Phase 4 is Narrative Prose Generation (app.engine.phase4_prose)
- Phase 5 is Async Post-Turn Clerk & Character State Engine (app.engine.phase5_clerk)

This module re-exports all post-turn clerk functionality from phase5_clerk for backward compatibility.
"""

from __future__ import annotations

from app.engine.phase5_clerk import *  # noqa: F401, F403
