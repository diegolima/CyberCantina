# CyberCantina

**CyberCantina** is an agentic AI roleplay framework designed as a next-generation successor to SillyTavern. Instead of treating LLMs as stateless text-completion wrappers, CyberCantina orchestrates a **5-Phase Canonical Cognitive Turn Pipeline**, a **Branch-Safe Spatial & World State Graph**, **3-Tier Episodic + Vector Memory**, and **AI Creation Wizards**.

📖 **Read our [Core Vision & Philosophy](VISION.md)** for an in-depth breakdown of our architectural tenets, KV-cache optimization strategy, multi-agent interiority model, and open-source roadmap.

## Core Architecture

### Authoring Layer: AI Wizards
- **Character Wizard (`1.1 Character`):** Expands brief character concepts into a static `core_persona`, `voice_anchors`, baseline psychological state (`valence`, `arousal`, `core_drive`, `core_fear`), and atomic `memory_shards` indexed directly into the semantic vector store.
- **World & Spatial Graph Wizard (`1.2 World Graph`):** Generates world rules, custom/ISO calendars, lore entries, and an initial topology of interconnected `LocationNode` and `LocationEdge` objects.

### Runtime Pipeline: 5-Phase Canonical Turn Execution
1. **Phase 1: Auxiliary Pre-Processor & Mechanics Engine (`phase1_pre.py`)**
   - Analyzes user sentiment/subtext, extracts referenced entities, generates semantic RAG queries, detects spatial movement intent, and triggers native **d20 RNG / Dice Mechanics** when risky actions are attempted.
2. **Phase 2: 4-Zone KV-Cache-Preserving Context Assembler (`phase2_context.py`)**
   - Keeps **Zone 1 (Static Prefix)** and **Zone 2 (Chunked Episodic Summaries)** strictly stable at the top of the prompt while injecting dynamic turn state (World Clock, 1-hop Spatial Neighbors, RAG memories, RNG results, and previous affect state) in **Zone 4 (Ephemeral Tail Frame)** to maximize KV-cache hit rates.
3. **Phase 3: Per-Character Multi-Cognition Swarm (`phase3_cognition.py`)**
   - Runs independent, concurrent cognitive evaluations for present characters emitting structured `<cognition>` blocks (`<recall>`, `<feeling>`, `<want>`, `<plan>`) before dialogue or action takes place.
4. **Phase 4: Narrative Prose Generation & Dual SSE Streaming (`phase4_prose.py`)**
   - Synthesizes rich literary prose guided by established character cognitions and choices, streaming both interior thoughts and narrative prose over independent channels.
5. **Phase 5: Async Post-Turn Clerk & State Engine (`phase5_clerk.py` & `character_agent.py`)**
   - Runs asynchronously after generation to advance the **World Clock**, update character locations (or dynamically improvise and link newly discovered `LocationNode` rooms in the spatial graph), arbitrate inventory transactions, extract memory shards into vector storage, and compress overflowing working memory turns into **Episodic Chunks**.
   - Every state snapshot, improvised location, and episodic memory is indexed to the **Turn Tree**, so swiping (regenerating), rewinding, or branching rolls back world state and memories instantaneously without corruption.

## Quick Start

### Option 1: Docker (Alpha Test / Pre-Built Images)

The easiest way to test CyberCantina without installing Python or Node development environments is using our pre-built alpha containers. Note that at this stage, releases do not follow a fixed schedule—new images may be published months, weeks, or minutes apart as features and fixes land.

```bash
docker compose up -d
```

Or run directly without cloning the repository:
```bash
curl -O https://raw.githubusercontent.com/diegolima/cybercantina/main/docker-compose.yml
docker compose up -d
```

Open **`http://localhost:3000`** in your browser.

To pull the latest alpha release at any time:
```bash
docker compose pull && docker compose up -d
```

---

### Option 2: Local Development (Build from Source)

#### With Docker Compose:
```bash
docker compose -f docker-compose.dev.yml up --build
```
Open **`http://localhost:3000`**.

#### Without Docker:

**1. Backend (Python / FastAPI)**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

**2. Frontend (React / TypeScript / Vite)**
```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`**.

---

### Model Setup & Ollama Recommendations

1. **Accessing the Studio:** Open `http://localhost:3000` (Docker) or `http://localhost:5173` (Vite dev).
2. **Configure Providers:** Go to **Admin Settings → Providers** to connect your model servers (e.g., local Ollama or hosted OpenAI-compatible endpoints), then pick a provider and model for the **Actor** and **Clerk** in **Models**. Admins can let users bring their own private providers (BYOP).
3. **Allow Two Simultaneous Models (Crucial for CPU SLM + Actor):**
   CyberCantina's 5-phase pipeline pairs a creative **Actor** (narrative prose) with an analytical **Clerk** (state updates, memory extraction, and character cognition, often running on a lightweight CPU SLM like `qwen2.5:3b` or `llama3.2:3b`).
   To avoid costly model-swapping latency on every turn, ensure your model server keeps **at least two models loaded in memory simultaneously**:
   * For **Ollama**, launch with:
     ```bash
     OLLAMA_MAX_LOADED_MODELS=2 ollama serve
     ```
   * **Linux Docker Note:** If running CyberCantina inside Docker with a host Ollama instance on Linux, configure Ollama to bind to all interfaces so the container can reach it via `host.docker.internal`:
     ```bash
     OLLAMA_HOST=0.0.0.0:11434 OLLAMA_MAX_LOADED_MODELS=2 ollama serve
     ```
4. **Security & Secrets:** Provider tokens are encrypted at rest with an auto-generated key (`/data/.cantina_secret.key` in Docker, or `backend/.cantina_secret.key` in local dev, configurable via `CYBERCANTINA_SECRET_KEY`). Back this key up alongside your database.
5. **Offline Mock Mode:** You can also enable the built-in **Heuristic / Mock Offline Fallback** in Settings to test the full 5-phase pipeline without an active LLM server.

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later** ([AGPL-3.0-or-later](LICENSE)).

Commercial use is permitted under the terms of the AGPLv3: anyone who distributes or runs CyberCantina over a network must provide the complete source code, including all modifications and customizations.

