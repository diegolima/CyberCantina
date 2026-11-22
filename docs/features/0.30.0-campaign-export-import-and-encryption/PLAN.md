---
feature: campaign-export-import-and-encryption
target_version: 0.30.0
document_type: plan
status: completed
last_updated: 2026-11-22
---

# Implementation Plan — v0.30.0 Campaign Export/Import & `.zcc` Encryption

- [x] Feature FRD, ARCHITECTURE, REVIEW & PLAN authored
- [x] `backend/app/security/zcc_crypto.py` (`ZCCENC01` Argon2id + chunked AES-256-GCM) & `rate_limit.py` / `purge_inactive.py`
- [x] `backend/app/schemas/import_export.py`, `turn.py` & `backend/app/db/repos/campaigns.py` (`world_name`/`character_name`/`character_portrait_url`)
- [x] `backend/app/services/zcc_campaign_io.py` & `import_export_service.py` (campaign export/import, timeline pruning, atomic commit, deep ID remap, unlock flow)
- [x] `backend/app/routers/import_export.py` (`POST /api/export/campaign/{id}`, `POST /api/export/{character,world}/{id}`, `POST /api/import/unlock`)
- [x] Frontend types, API client, pure helpers, `ExportCampaignModal.tsx`, `ImportPreviewModal.tsx` unlock/campaign flow, universal password option, sidebar/picker triggers
- [x] Backend & frontend test suites (`test_zcc_crypto.py`, `test_campaign_import_export.py`, `campaignExportImport.test.tsx`)
- [x] Architecture docs regeneration (`scripts/generate_arch_docs.py --check`) & user-facing wiki updates (`../cybercantina-wiki`)
- [x] Full backend & frontend verification gates (`ruff`, `tach`, `pytest`, `arch:check`, `build`, `vitest`)
