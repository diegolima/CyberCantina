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
    b_9["components/party"]
    b_10["components/prompts"]
    b_11["components/providers"]
    b_12["components/shared"]
    b_13["components/wizard"]
    b_14["components/world"]
    b_15["hooks"]
    b_16["local"]
    b_17["main"]
    b_18["providers"]
    b_19["types"]
    b_20["utils"]
    b_0 --> b_1
    b_0 --> b_2
    b_0 --> b_9
    b_0 --> b_14
    b_0 --> b_15
    b_0 --> b_18
    b_0 --> b_19
    b_0 --> b_20
    b_1 --> b_19
    b_2 --> b_1
    b_2 --> b_3
    b_2 --> b_4
    b_2 --> b_5
    b_2 --> b_6
    b_2 --> b_7
    b_2 --> b_10
    b_2 --> b_12
    b_2 --> b_13
    b_2 --> b_14
    b_2 --> b_15
    b_2 --> b_18
    b_2 --> b_19
    b_2 --> b_20
    b_3 --> b_1
    b_3 --> b_2
    b_3 --> b_8
    b_3 --> b_11
    b_3 --> b_12
    b_3 --> b_19
    b_3 --> b_20
    b_4 --> b_1
    b_4 --> b_2
    b_4 --> b_12
    b_4 --> b_19
    b_4 --> b_20
    b_5 --> b_2
    b_5 --> b_6
    b_5 --> b_12
    b_5 --> b_15
    b_5 --> b_19
    b_5 --> b_20
    b_6 --> b_2
    b_6 --> b_7
    b_6 --> b_12
    b_6 --> b_19
    b_6 --> b_20
    b_7 --> b_2
    b_7 --> b_6
    b_7 --> b_12
    b_7 --> b_15
    b_7 --> b_19
    b_8 --> b_11
    b_8 --> b_16
    b_8 --> b_19
    b_9 --> b_19
    b_9 --> b_20
    b_11 --> b_1
    b_11 --> b_16
    b_11 --> b_18
    b_11 --> b_19
    b_12 --> b_19
    b_12 --> b_20
    b_13 --> b_1
    b_13 --> b_2
    b_13 --> b_19
    b_14 --> b_1
    b_14 --> b_2
    b_14 --> b_7
    b_14 --> b_12
    b_14 --> b_19
    b_14 --> b_20
    b_15 --> b_1
    b_15 --> b_19
    b_15 --> b_20
    b_16 --> b_19
    b_17 --> b_0
    b_18 --> b_1
    b_18 --> b_16
    b_18 --> b_19
    b_20 --> b_19
```

## Bucket Inventory

| Bucket | Files | Outgoing Dependencies |
| :--- | ---: | :--- |
| `App` | 1 | `api`, `components (root)`, `components/party`, `components/world`, `hooks`, `providers`, `types`, `utils` |
| `api` | 14 | `types` |
| `components (root)` | 24 | `api`, `components/auth`, `components/character`, `components/chat`, `components/inspector`, `components/map`, `components/prompts`, `components/shared`, `components/wizard`, `components/world`, `hooks`, `providers`, `types`, `utils` |
| `components/auth` | 13 | `api`, `components (root)`, `components/models`, `components/providers`, `components/shared`, `types`, `utils` |
| `components/character` | 12 | `api`, `components (root)`, `components/shared`, `types`, `utils` |
| `components/chat` | 11 | `components (root)`, `components/inspector`, `components/shared`, `hooks`, `types`, `utils` |
| `components/inspector` | 13 | `components (root)`, `components/map`, `components/shared`, `types`, `utils` |
| `components/map` | 15 | `components (root)`, `components/inspector`, `components/shared`, `hooks`, `types` |
| `components/models` | 12 | `components/providers`, `local`, `types` |
| `components/party` | 1 | `types`, `utils` |
| `components/prompts` | 3 | *(leaf)* |
| `components/providers` | 5 | `api`, `local`, `providers`, `types` |
| `components/shared` | 5 | `types`, `utils` |
| `components/wizard` | 2 | `api`, `components (root)`, `types` |
| `components/world` | 8 | `api`, `components (root)`, `components/map`, `components/shared`, `types`, `utils` |
| `hooks` | 3 | `api`, `types`, `utils` |
| `local` | 7 | `types` |
| `main` | 1 | `App`, `styles.css` |
| `providers` | 1 | `api`, `local`, `types` |
| `types` | 14 | *(leaf)* |
| `utils` | 13 | `types` |
