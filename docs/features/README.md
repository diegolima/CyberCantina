# Feature Specifications & Implementation Trail

This directory contains versioned feature requirements, architectural designs, reviews, and implementation plans.

## Purpose & Agent Guidelines
- Every non-trivial feature or architectural change must have a dedicated package directory: `docs/features/TBD-<feature-slug>/` while in progress, renamed to `docs/features/<semver>-<feature-slug>/` at merge time.
- Create the isolated feature worktree (`scripts/worktree.sh create <slug>`) **before** authoring the feature package so `main` stays clean during parallel ideation.
- Author `FRD.md`, `REVIEW.md`, and `PLAN.md` (plus optional `ARCHITECTURE.md`) and **stop for explicit user approval** before writing production code (unless the user explicitly waives the package).
- Living end-user guides and setup tutorials belong in the [cybercantina-wiki](https://github.com/diegolima/cybercantina/wiki). Record planned `../cybercantina-wiki` page/section updates inside `PLAN.md` during implementation and apply/commit them at merge time so parallel features do not collide on `master`.

## Directory Structure per Feature
```text
docs/features/TBD-<feature-slug>/   # renamed to <semver>-<feature-slug>/ on merge
├── FRD.md             # Feature Requirements Document (Problem, Scope, Core Invariants)
├── ARCHITECTURE.md    # (Optional) Deep-dive technical architecture, DDL, and data models
├── REVIEW.md          # Pre-implementation architectural review, edge cases & traps
└── PLAN.md            # Implementation tasks, verification matrix, wiki plan & progress
```

## Standard Document Header
Each document should include frontmatter or a standardized header:
```markdown
---
feature: <feature-slug>
target_version: TBD   # stamped to <semver> upon merge
document_type: frd | architecture | review | plan
status: draft | under_review | approved | in_progress | completed | superseded
last_updated: YYYY-MM-DD
---
```
