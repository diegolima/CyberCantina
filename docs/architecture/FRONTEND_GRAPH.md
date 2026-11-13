# Frontend Module & Boundary Graph

Rules enforced by `npm --prefix frontend run arch:check` via [frontend/.dependency-cruiser.cjs](../../frontend/.dependency-cruiser.cjs):
- `src/types/` has zero outgoing runtime dependencies.
- `src/api/` may depend only on `src/api/` and `src/types/`.
- `src/utils/` and `src/local/` may depend only on `src/types/` and sibling utilities.
- `src/providers/` cannot import `src/components/` or `src/hooks/`.
- `src/hooks/` cannot import `src/components/`.
- Runtime circular dependencies are forbidden (`no-circular`).
- To inspect file-level Mermaid output locally, run `npm --prefix frontend run arch:graph`.

## Bucket-Level Dependency Graph

```mermaid
flowchart TD
    b_0["App"]
    b_1["api"]
    b_2["components (root)"]
    b_3["components/auth"]
    b_4["components/character"]
    b_5["components/chat"]
    b_6["components/inspector"]
    b_7["components/map"]
    b_8["components/models"]
    b_9["components/prompts"]
    b_10["components/providers"]
    b_11["components/shared"]
    b_12["components/wizard"]
    b_13["components/world"]
    b_14["hooks"]
    b_15["local"]
    b_16["main"]
    b_17["providers"]
    b_18["types"]
    b_19["utils"]
    b_0 --> b_1
    b_0 --> b_2
    b_0 --> b_14
    b_0 --> b_17
    b_0 --> b_18
    b_0 --> b_19
    b_1 --> b_18
    b_2 --> b_1
    b_2 --> b_3
    b_2 --> b_4
    b_2 --> b_5
    b_2 --> b_6
    b_2 --> b_7
    b_2 --> b_9
    b_2 --> b_11
    b_2 --> b_12
    b_2 --> b_13
    b_2 --> b_14
    b_2 --> b_17
    b_2 --> b_18
    b_2 --> b_19
    b_3 --> b_1
    b_3 --> b_2
    b_3 --> b_8
    b_3 --> b_10
    b_3 --> b_18
    b_4 --> b_1
    b_4 --> b_2
    b_4 --> b_11
    b_4 --> b_18
    b_5 --> b_2
    b_5 --> b_6
    b_5 --> b_14
    b_5 --> b_18
    b_5 --> b_19
    b_6 --> b_2
    b_6 --> b_7
    b_6 --> b_18
    b_6 --> b_19
    b_7 --> b_2
    b_7 --> b_14
    b_7 --> b_18
    b_8 --> b_10
    b_8 --> b_15
    b_8 --> b_18
    b_10 --> b_1
    b_10 --> b_15
    b_10 --> b_17
    b_10 --> b_18
    b_12 --> b_1
    b_12 --> b_2
    b_12 --> b_18
    b_13 --> b_1
    b_13 --> b_2
    b_13 --> b_7
    b_13 --> b_11
    b_13 --> b_18
    b_14 --> b_1
    b_14 --> b_18
    b_15 --> b_18
    b_16 --> b_0
    b_17 --> b_1
    b_17 --> b_15
    b_17 --> b_18
    b_19 --> b_18
```

## Bucket Inventory

| Bucket | Files | Total LOC | Outgoing Dependencies |
| :--- | ---: | ---: | :--- |
| `App` | 1 | 842 | `api`, `components (root)`, `hooks`, `providers`, `types`, `utils` |
| `api` | 13 | 1558 | `types` |
| `components (root)` | 23 | 12126 | `api`, `components/auth`, `components/character`, `components/chat`, `components/inspector`, `components/map`, `components/prompts`, `components/shared`, `components/wizard`, `components/world`, `hooks`, `providers`, `types`, `utils` |
| `components/auth` | 9 | 4355 | `api`, `components (root)`, `components/models`, `components/providers`, `types` |
| `components/character` | 10 | 3749 | `api`, `components (root)`, `components/shared`, `types` |
| `components/chat` | 5 | 2805 | `components (root)`, `components/inspector`, `hooks`, `types`, `utils` |
| `components/inspector` | 11 | 5361 | `components (root)`, `components/map`, `types`, `utils` |
| `components/map` | 12 | 7053 | `components (root)`, `hooks`, `types` |
| `components/models` | 12 | 2529 | `components/providers`, `local`, `types` |
| `components/prompts` | 3 | 214 | *(leaf)* |
| `components/providers` | 5 | 1250 | `api`, `local`, `providers`, `types` |
| `components/shared` | 1 | 146 | *(leaf)* |
| `components/wizard` | 2 | 665 | `api`, `components (root)`, `types` |
| `components/world` | 2 | 1353 | `api`, `components (root)`, `components/map`, `components/shared`, `types` |
| `hooks` | 2 | 719 | `api`, `types` |
| `local` | 5 | 778 | `types` |
| `main` | 1 | 10 | `App`, `styles.css` |
| `providers` | 1 | 447 | `api`, `local`, `types` |
| `types` | 12 | 1790 | *(leaf)* |
| `utils` | 6 | 770 | `types` |
