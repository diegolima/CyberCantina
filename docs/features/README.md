# Feature Specifications & Implementation Trail

This directory contains versioned feature requirements, architectural designs, reviews, and implementation plans.

## Purpose & Agent Guidelines
- Every non-trivial feature or architectural change must have a dedicated package directory: `docs/features/<target-version>-<feature-slug>/`.
- AI agents working on features should inspect the documents in that feature's package before writing code.
- Living end-user guides and setup tutorials belong in the [cybercantina-wiki](https://github.com/diegolima/cybercantina/wiki). Versioned feature design, requirements, and review artifacts belong here in git.

## Directory Structure per Feature
```text
docs/features/<target-version>-<feature-slug>/
├── FRD.md             # Feature Requirements Document (Problem, Scope, Core Invariants)
├── ARCHITECTURE.md    # (Optional) Deep-dive technical architecture, DDL, and data models
├── REVIEW.md          # Pre-implementation architectural review, edge cases & traps
└── PLAN.md            # Implementation tasks, verification matrix & progress
```

## Standard Document Header
Each document should include frontmatter or a standardized header:
```markdown
---
feature: <feature-slug>
target_version: <semver>
document_type: frd | architecture | review | plan
status: draft | under_review | approved | in_progress | completed | superseded
last_updated: YYYY-MM-DD
---
```
