"""Generate deterministic CyberCantina architecture docs under docs/architecture/.

Usage:
    backend/.venv/bin/python scripts/generate_arch_docs.py
    backend/.venv/bin/python scripts/generate_arch_docs.py --check
"""

from __future__ import annotations

import argparse
import ast
from collections import defaultdict
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"
DOCS_DIR = REPO_ROOT / "docs" / "architecture"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.routing import APIRoute, APIWebSocketRoute  # noqa: E402

from app.main import app as fastapi_app  # noqa: E402

_CREATE_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s*\(",
)
_REFERENCES_RE = re.compile(r"REFERENCES\s+([a-zA-Z0-9_]+)\s*\(")
_API_TEMPLATE_RE = re.compile(r"\$\{API_BASE\}([^`'\"?\s,]+)")
_API_LITERAL_RE = re.compile(r"(/api/[a-zA-Z0-9_./{}$-]+)")
_TS_IMPORT_RE = re.compile(
    r"""(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["'](\.[^"']+)["']"""
)
_INTERPOLATION_RE = re.compile(r"\$\{[^}]+\}")
_FASTAPI_PARAM_RE = re.compile(r"\{[^}]+\}")


def _extract_module_doc(path: Path) -> str:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return ""
    doc = ast.get_docstring(tree) or ""
    first_line = doc.strip().splitlines()[0].strip() if doc.strip() else ""
    return first_line[:110]


def _count_lines(path: Path) -> int:
    try:
        return sum(1 for _ in path.open("r", encoding="utf-8"))
    except OSError:
        return 0


def _bucket_backend_path(rel_path: Path) -> str:
    parts = list(rel_path.parts)
    if parts[-1] == "__init__.py":
        parts = parts[:-1]
    else:
        parts[-1] = parts[-1].removesuffix(".py")
    if len(parts) < 2:
        return parts[0]
    if parts[1] == "engine" and len(parts) >= 3:
        return f"app.engine.{parts[2]}"
    if parts[1] == "db" and len(parts) >= 3 and parts[2] == "repos":
        return "app.db.repos"
    if parts[1] == "routers" and len(parts) >= 3 and parts[2] == "campaign_routes":
        return "app.routers.campaign_routes"
    if parts[1] == "wizards" and len(parts) >= 3 and parts[2] == "char_gen":
        return "app.wizards.char_gen"
    return f"app.{parts[1]}"


def _bucket_frontend_path(rel_path: Path) -> str:
    parts = list(rel_path.parts)
    if parts[0] == "components":
        if len(parts) == 2:
            return "components (root)"
        return f"components/{parts[1]}"
    return parts[0].removesuffix(".tsx").removesuffix(".ts")


def _normalize_endpoint_key(path: str) -> str:
    no_query = path.split("?", 1)[0]
    replaced = _INTERPOLATION_RE.sub("{}", no_query)
    replaced = _FASTAPI_PARAM_RE.sub("{}", replaced)
    return replaced.rstrip("/") or "/"


def _scan_frontend_api_calls() -> dict[str, set[str]]:
    """Map normalized /api/... path -> set of frontend api/*.ts filenames."""
    api_dir = FRONTEND_SRC / "api"
    mapping: dict[str, set[str]] = defaultdict(set)
    for ts_file in sorted(api_dir.glob("*.ts")):
        if ts_file.name.endswith(".test.ts"):
            continue
        text = ts_file.read_text(encoding="utf-8")
        for match in _API_TEMPLATE_RE.finditer(text):
            full = "/api" + match.group(1)
            mapping[_normalize_endpoint_key(full)].add(f"frontend/src/api/{ts_file.name}")
        for match in _API_LITERAL_RE.finditer(text):
            full = match.group(1)
            mapping[_normalize_endpoint_key(full)].add(f"frontend/src/api/{ts_file.name}")
    return mapping


def _collect_fastapi_routes() -> list[tuple[str, str, str, str]]:
    """Return sorted list of (methods, path, handler_module.func, response_model)."""
    rows: list[tuple[str, str, str, str]] = []

    def _record_route(obj: object) -> None:
        if hasattr(obj, "effective_route_contexts"):
            for ctx in obj.effective_route_contexts():  # type: ignore[attr-defined]
                orig = getattr(ctx, "original_route", None)
                route_path = ctx.path or getattr(orig, "path", "")
                ep = getattr(ctx, "endpoint", None) or getattr(orig, "endpoint", None)
                handler = f"{ep.__module__}.{ep.__name__}" if ep is not None else "—"
                if isinstance(orig, APIWebSocketRoute):
                    rows.append(("WS", route_path, handler, ""))
                    continue
                methods_set = getattr(ctx, "methods", None) or getattr(orig, "methods", None) or set()
                methods = ", ".join(sorted(m for m in methods_set if m not in {"HEAD", "OPTIONS"})) or "GET"
                rm = getattr(ctx, "response_model", None) or getattr(orig, "response_model", None)
                resp_model = getattr(rm, "__name__", str(rm)) if rm is not None else ""
                rows.append((methods, route_path, handler, resp_model))
            return

        if isinstance(obj, APIRoute):
            methods = ", ".join(sorted(m for m in obj.methods if m not in {"HEAD", "OPTIONS"}))
            handler = f"{obj.endpoint.__module__}.{obj.endpoint.__name__}"
            resp_model = ""
            if obj.response_model is not None:
                resp_model = getattr(obj.response_model, "__name__", str(obj.response_model))
            rows.append((methods, obj.path, handler, resp_model))
        elif isinstance(obj, APIWebSocketRoute):
            handler = f"{obj.endpoint.__module__}.{obj.endpoint.__name__}"
            rows.append(("WS", obj.path, handler, ""))

    for route in fastapi_app.routes:
        _record_route(route)
    return sorted(rows, key=lambda item: (item[1], item[0]))


def _parse_schema_sql() -> tuple[list[tuple[str, int, list[str]]], list[tuple[str, str]]]:
    """Parse CREATE TABLE definitions and foreign-key edges from schema.sql."""
    schema_path = BACKEND_DIR / "app" / "db" / "schema.sql"
    sql = schema_path.read_text(encoding="utf-8")
    tables: list[tuple[str, int, list[str]]] = []
    fk_edges: set[tuple[str, str]] = set()

    current_table: str | None = None
    start_line = 0
    current_fks: list[str] = []

    for lineno, line in enumerate(sql.splitlines(), start=1):
        m_tbl = _CREATE_TABLE_RE.search(line)
        if m_tbl:
            current_table = m_tbl.group(1)
            start_line = lineno
            current_fks = []
            continue
        if current_table is not None:
            for m_fk in _REFERENCES_RE.finditer(line):
                parent = m_fk.group(1)
                current_fks.append(parent)
                fk_edges.add((current_table, parent))
            if line.strip().startswith(");"):
                tables.append((current_table, start_line, sorted(set(current_fks))))
                current_table = None
                current_fks = []

    return tables, sorted(fk_edges)


def _run_tach_mermaid() -> str:
    tach_bin = Path(sys.executable).parent / "tach"
    if not tach_bin.exists():
        tach_bin = BACKEND_DIR / ".venv" / "bin" / "tach"
    env = dict(os.environ)
    env["NO_COLOR"] = "1"
    proc = subprocess.run(
        [str(tach_bin), "show", "--mermaid", "-o", "-"],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    lines: list[str] = []
    in_graph = False
    for line in proc.stdout.splitlines():
        if line.strip().startswith("graph "):
            in_graph = True
        if in_graph:
            lines.append(line.rstrip())
    return "\n".join(lines).strip()


def _render_readme() -> str:
    return """# CyberCantina Architecture Reference

Generated deterministically by `scripts/generate_arch_docs.py`. Start here for fast codebase orientation before reading implementation files.

## Quick Links

- [Backend Module Graph](BACKEND_GRAPH.md) — `tach.toml` domain boundaries & Mermaid graph
- [Frontend Module Graph](FRONTEND_GRAPH.md) — `dependency-cruiser` TS/React buckets & rules
- [Cross-Layer API, Schema & Module Map](CROSS_LAYER_MAP.md) — FastAPI routes paired with `frontend/src/api/*.ts`, SQLite ER diagram, and per-file package index

## Runtime Layer Overview

```mermaid
flowchart LR
    UI["frontend/src/components & hooks"] --> API["frontend/src/api & types"]
    API -->|"HTTP JSON / SSE + WS"| Routers["backend/app/routers"]
    Routers --> Services["app.services & app.wizards"]
    Routers --> Engine["app.engine (5-Phase Turn Pipeline)"]
    Services --> DB["app.db (SQLite + Vec RAG)"]
    Engine --> DB
    Engine --> Providers["app.providers & app.engine.llm_client"]
    DB --> Schemas["app.schemas & app.config & app.security"]
```

## 5-Phase Turn Pipeline (`backend/app/engine/`)

1. **Phase 1 (`phase1_pre.py` / `choices.py`)**: Spatial/mechanics intent analysis, d20 dice resolution, and character choice evaluation.
2. **Phase 2 (`phase2_context.py` -> `context/`)**: 4-Zone KV-cache prompt assembly (`zone1_static`, `zone2_episodic` LOD + vector recall, `zone3_history` `@Character` epistemic filter, `zone4_ephemeral` turn state).
3. **Phase 3 (`phase3_cognition.py` -> `cognition/` + `phase3_actor.py`)**: Private `<cognition>` thought generation per present character.
4. **Phase 4 (`phase4_prose.py`)**: Character/Narrator in-character prose streaming over SSE.
5. **Phase 5 (`phase5_clerk.py` -> `clerk/` + `character_agent.py` -> `char_agent/`)**: Async post-turn memory extraction, CARE-v1 affective integration (`affective/`), inventory lock arbitration, gossip propagation, and episodic compaction.

## Canonical Packages vs. Compatibility Facades

New domain logic belongs in the decomposed subpackages; root facades remain thin re-export & `monkeypatch` seams for existing tests:

| Canonical Subpackage / Directory | Compatibility Facade / Barrel |
| :--- | :--- |
| `backend/app/db/repos/` | `backend/app/db/repository.py` |
| `backend/app/db/vector_math.py` | `backend/app/db/vector_store.py` |
| `backend/app/engine/affective/` | `backend/app/engine/affective_engine.py` |
| `backend/app/engine/context/` | `backend/app/engine/phase2_context.py` |
| `backend/app/engine/cognition/` | `backend/app/engine/phase3_cognition.py` |
| `backend/app/engine/char_agent/` | `backend/app/engine/character_agent.py` |
| `backend/app/engine/clerk/` | `backend/app/engine/phase5_clerk.py` |
| `backend/app/routers/campaign_routes/` | `backend/app/routers/campaigns.py` |
| `backend/app/wizards/char_gen/` | `backend/app/wizards/character_wizard.py` |
| `frontend/src/types/` | `frontend/src/types/index.ts` |
| `frontend/src/api/` | `frontend/src/api/index.ts` |
| `frontend/src/components/{auth,character,chat,inspector,map,wizard,world}/` | `EntityEditorModals.tsx`, `WizardModals.tsx` |

## Verification & Regeneration Commands

- Regenerate architecture docs: `backend/.venv/bin/python scripts/generate_arch_docs.py`
- Verify freshness (non-zero if stale): `backend/.venv/bin/python scripts/generate_arch_docs.py --check`
- Backend lint + architecture boundaries + tests:
  - `cd backend && .venv/bin/ruff check app tests`
  - `cd backend && .venv/bin/tach check`
  - `backend/.venv/bin/pytest backend/tests`
- Frontend architecture boundaries + build + tests:
  - `npm --prefix frontend run arch:check`
  - `npm --prefix frontend run build && npm --prefix frontend test`
"""


def _render_backend_graph() -> str:
    tach_cfg = tomllib.loads((BACKEND_DIR / "tach.toml").read_text(encoding="utf-8"))
    modules = sorted(tach_cfg.get("modules", []), key=lambda m: m["path"])
    mermaid = _run_tach_mermaid()

    lines = [
        "# Backend Architecture & Dependency Graph",
        "",
        "Source of truth: [backend/tach.toml](../../backend/tach.toml) validated by `tach check`.",
        "",
        "## Declared Domain Boundaries",
        "",
        "| Module | Allowed `depends_on` |",
        "| :--- | :--- |",
    ]
    for mod in modules:
        deps = ", ".join(f"`{d}`" for d in sorted(mod.get("depends_on", []))) or "*(leaf / none)*"
        lines.append(f"| `{mod['path']}` | {deps} |")

    lines.extend(
        [
            "",
            "## Full Module Graph (`tach show --mermaid`)",
            "",
            "```mermaid",
            mermaid,
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def _scan_frontend_buckets() -> tuple[dict[str, set[str]], dict[str, list[Path]]]:
    edges: dict[str, set[str]] = defaultdict(set)
    files_by_bucket: dict[str, list[Path]] = defaultdict(list)

    for path in sorted(FRONTEND_SRC.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in {".ts", ".tsx"} or ".test." in path.name:
            continue
        rel = path.relative_to(FRONTEND_SRC)
        if rel.parts[0] == "test":
            continue
        src_bucket = _bucket_frontend_path(rel)
        files_by_bucket[src_bucket].append(path)
        edges.setdefault(src_bucket, set())

        content = path.read_text(encoding="utf-8")
        for match in _TS_IMPORT_RE.finditer(content):
            raw_target = match.group(1)
            norm = os.path.normpath(os.path.join(str(rel.parent), raw_target)).replace("\\", "/")
            if norm.startswith(".."):
                continue
            tgt_bucket = _bucket_frontend_path(Path(norm))
            if tgt_bucket != src_bucket:
                edges[src_bucket].add(tgt_bucket)

    return edges, files_by_bucket


def _render_frontend_graph() -> str:
    edges, files_by_bucket = _scan_frontend_buckets()
    node_ids = {b: f"b_{i}" for i, b in enumerate(sorted(files_by_bucket.keys()))}

    mermaid_lines = ["flowchart TD"]
    for bucket in sorted(files_by_bucket.keys()):
        mermaid_lines.append(f'    {node_ids[bucket]}["{bucket}"]')
    for src in sorted(files_by_bucket.keys()):
        for tgt in sorted(edges.get(src, set())):
            if tgt in node_ids:
                mermaid_lines.append(f"    {node_ids[src]} --> {node_ids[tgt]}")

    lines = [
        "# Frontend Module & Boundary Graph",
        "",
        "Rules enforced by `npm --prefix frontend run arch:check` via [frontend/.dependency-cruiser.cjs](../../frontend/.dependency-cruiser.cjs):",
        "- `src/types/` has zero outgoing runtime dependencies.",
        "- `src/api/` may depend only on `src/api/` and `src/types/`.",
        "- `src/utils/` and `src/local/` may depend only on `src/types/` and sibling utilities.",
        "- `src/providers/` cannot import `src/components/` or `src/hooks/`.",
        "- `src/hooks/` cannot import `src/components/`.",
        "- Runtime circular dependencies are forbidden (`no-circular`).",
        "- To inspect file-level Mermaid output locally, run `npm --prefix frontend run arch:graph`.",
        "",
        "## Bucket-Level Dependency Graph",
        "",
        "```mermaid",
        *mermaid_lines,
        "```",
        "",
        "## Bucket Inventory",
        "",
        "| Bucket | Files | Total LOC | Outgoing Dependencies |",
        "| :--- | ---: | ---: | :--- |",
    ]
    for bucket in sorted(files_by_bucket.keys()):
        paths = files_by_bucket[bucket]
        total_loc = sum(_count_lines(p) for p in paths)
        deps = ", ".join(f"`{d}`" for d in sorted(edges.get(bucket, set()))) or "*(leaf)*"
        lines.append(f"| `{bucket}` | {len(paths)} | {total_loc} | {deps} |")

    lines.append("")
    return "\n".join(lines)


def _render_cross_layer_map() -> str:
    routes = _collect_fastapi_routes()
    fe_api_map = _scan_frontend_api_calls()
    tables, fk_edges = _parse_schema_sql()
    _, fe_files_by_bucket = _scan_frontend_buckets()

    lines = [
        "# Cross-Layer API, Schema & Package Index",
        "",
        "## 1. FastAPI Routes <-> Frontend API Client Matrix",
        "",
        "| Method | Path | Backend Handler | Response Schema | Frontend Client |",
        "| :--- | :--- | :--- | :--- | :--- |",
    ]
    for methods, path, handler, resp_model in routes:
        norm = _normalize_endpoint_key(path)
        fe_sources = sorted(fe_api_map.get(norm, set()))
        fe_col = ", ".join(f"`{s}`" for s in fe_sources) if fe_sources else "*(backend-only / test / SSE)*"
        resp_col = f"`{resp_model}`" if resp_model else "—"
        lines.append(f"| `{methods}` | `{path}` | `{handler}` | {resp_col} | {fe_col} |")

    lines.extend(
        [
            "",
            "## 2. SQLite Schema (`backend/app/db/schema.sql`)",
            "",
            "```mermaid",
            "erDiagram",
        ]
    )
    table_names = {t[0] for t in tables}
    for child, parent in fk_edges:
        if child in table_names and parent in table_names:
            lines.append(f"    {parent} ||--o{{ {child} : references")
    lines.extend(
        [
            "```",
            "",
            "| Table | DDL Line | Foreign-Key Parents |",
            "| :--- | ---: | :--- |",
        ]
    )
    for tbl, lineno, parents in tables:
        p_str = ", ".join(f"`{p}`" for p in parents) if parents else "—"
        lines.append(f"| `{tbl}` | {lineno} | {p_str} |")

    lines.extend(
        [
            "",
            "## 3. Domain Package File Index",
            "",
            "### Backend (`backend/app/`)",
            "",
        ]
    )
    backend_groups: dict[str, list[Path]] = defaultdict(list)
    for py_path in sorted((BACKEND_DIR / "app").rglob("*.py")):
        if "__pycache__" in py_path.parts:
            continue
        rel = py_path.relative_to(BACKEND_DIR)
        backend_groups[_bucket_backend_path(rel)].append(py_path)

    for group in sorted(backend_groups.keys()):
        lines.append(f"#### `{group}`")
        lines.append("")
        lines.append("| File | LOC | Summary |")
        lines.append("| :--- | ---: | :--- |")
        for py_path in sorted(backend_groups[group]):
            rel = py_path.relative_to(REPO_ROOT).as_posix()
            loc = _count_lines(py_path)
            doc = _extract_module_doc(py_path) or "—"
            lines.append(f"| `{rel}` | {loc} | {doc.replace('|', '/')} |")
        lines.append("")

    lines.extend(["### Frontend (`frontend/src/`)", ""])
    for bucket in sorted(fe_files_by_bucket.keys()):
        lines.append(f"#### `{bucket}`")
        lines.append("")
        lines.append("| File | LOC |")
        lines.append("| :--- | ---: |")
        for ts_path in sorted(fe_files_by_bucket[bucket]):
            rel = ts_path.relative_to(REPO_ROOT).as_posix()
            lines.append(f"| `{rel}` | {_count_lines(ts_path)} |")
        lines.append("")

    return "\n".join(lines)


def build_outputs() -> dict[Path, str]:
    return {
        DOCS_DIR / "README.md": _render_readme(),
        DOCS_DIR / "BACKEND_GRAPH.md": _render_backend_graph(),
        DOCS_DIR / "FRONTEND_GRAPH.md": _render_frontend_graph(),
        DOCS_DIR / "CROSS_LAYER_MAP.md": _render_cross_layer_map(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate or verify docs/architecture/ artifacts.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if committed docs/architecture/ files differ from generated output.",
    )
    args = parser.parse_args(argv)

    outputs = build_outputs()
    if args.check:
        stale: list[str] = []
        for target, expected in outputs.items():
            current = target.read_text(encoding="utf-8") if target.exists() else None
            if current != expected:
                stale.append(target.relative_to(REPO_ROOT).as_posix())
        if stale:
            print("Stale architecture docs detected:", ", ".join(stale), file=sys.stderr)
            return 1
        print(f"Architecture docs up to date ({len(outputs)} files verified).")
        return 0

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    for target, content in outputs.items():
        target.write_text(content, encoding="utf-8")
        print(f"Wrote {target.relative_to(REPO_ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
