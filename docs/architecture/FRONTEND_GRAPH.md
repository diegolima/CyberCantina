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
    b_13["components/story"]
    b_14["components/wizard"]
    b_15["components/world"]
    b_16["hooks"]
    b_17["local"]
    b_18["main"]
    b_19["providers"]
    b_20["types"]
    b_21["utils"]
    b_0 --> b_1
    b_0 --> b_2
    b_0 --> b_9
    b_0 --> b_13
    b_0 --> b_15
    b_0 --> b_16
    b_0 --> b_19
    b_0 --> b_20
    b_0 --> b_21
    b_1 --> b_20
    b_2 --> b_1
    b_2 --> b_3
    b_2 --> b_4
    b_2 --> b_5
    b_2 --> b_6
    b_2 --> b_7
    b_2 --> b_10
    b_2 --> b_12
    b_2 --> b_14
    b_2 --> b_15
    b_2 --> b_16
    b_2 --> b_19
    b_2 --> b_20
    b_2 --> b_21
    b_3 --> b_1
    b_3 --> b_2
    b_3 --> b_8
    b_3 --> b_11
    b_3 --> b_12
    b_3 --> b_20
    b_3 --> b_21
    b_4 --> b_1
    b_4 --> b_2
    b_4 --> b_12
    b_4 --> b_20
    b_4 --> b_21
    b_5 --> b_2
    b_5 --> b_6
    b_5 --> b_12
    b_5 --> b_16
    b_5 --> b_20
    b_5 --> b_21
    b_6 --> b_2
    b_6 --> b_7
    b_6 --> b_12
    b_6 --> b_20
    b_6 --> b_21
    b_7 --> b_2
    b_7 --> b_6
    b_7 --> b_12
    b_7 --> b_16
    b_7 --> b_20
    b_8 --> b_11
    b_8 --> b_17
    b_8 --> b_20
    b_9 --> b_20
    b_9 --> b_21
    b_11 --> b_1
    b_11 --> b_17
    b_11 --> b_19
    b_11 --> b_20
    b_12 --> b_20
    b_12 --> b_21
    b_13 --> b_2
    b_13 --> b_20
    b_14 --> b_1
    b_14 --> b_2
    b_14 --> b_20
    b_15 --> b_1
    b_15 --> b_2
    b_15 --> b_7
    b_15 --> b_12
    b_15 --> b_20
    b_15 --> b_21
    b_16 --> b_1
    b_16 --> b_20
    b_16 --> b_21
    b_17 --> b_20
    b_18 --> b_0
    b_19 --> b_1
    b_19 --> b_17
    b_19 --> b_20
    b_21 --> b_20
```

## Bucket Inventory

| Bucket | Files | Outgoing Dependencies |
| :--- | ---: | :--- |
| `App` | 1 | `api`, `components (root)`, `components/party`, `components/story`, `components/world`, `hooks`, `providers`, `types`, `utils` |
| `api` | 15 | `types` |
| `components (root)` | 25 | `api`, `components/auth`, `components/character`, `components/chat`, `components/inspector`, `components/map`, `components/prompts`, `components/shared`, `components/wizard`, `components/world`, `hooks`, `providers`, `types`, `utils` |
| `components/auth` | 14 | `api`, `components (root)`, `components/models`, `components/providers`, `components/shared`, `types`, `utils` |
| `components/character` | 12 | `api`, `components (root)`, `components/shared`, `types`, `utils` |
| `components/chat` | 17 | `components (root)`, `components/inspector`, `components/shared`, `hooks`, `types`, `utils` |
| `components/inspector` | 13 | `components (root)`, `components/map`, `components/shared`, `types`, `utils` |
| `components/map` | 15 | `components (root)`, `components/inspector`, `components/shared`, `hooks`, `types` |
| `components/models` | 12 | `components/providers`, `local`, `types` |
| `components/party` | 1 | `types`, `utils` |
| `components/prompts` | 3 | *(leaf)* |
| `components/providers` | 5 | `api`, `local`, `providers`, `types` |
| `components/shared` | 5 | `types`, `utils` |
| `components/story` | 5 | `components (root)`, `types` |
| `components/wizard` | 2 | `api`, `components (root)`, `types` |
| `components/world` | 8 | `api`, `components (root)`, `components/map`, `components/shared`, `types`, `utils` |
| `hooks` | 4 | `api`, `types`, `utils` |
| `local` | 7 | `types` |
| `main` | 1 | `App`, `styles.css` |
| `providers` | 1 | `api`, `local`, `types` |
| `types` | 16 | *(leaf)* |
| `utils` | 14 | `types` |
