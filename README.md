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

### 1. Backend (Python / FastAPI)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend (React / TypeScript / Vite)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` to launch the CyberCantina Roleplay Studio. Add your model servers in **Admin Settings → Providers** (Ollama today; an optional bearer token supports hosted endpoints), then pick a provider and model for the Actor and Clerk in **Models**. Admins can let users bring their own private providers (BYOP). Provider tokens are encrypted at rest with an auto-generated key (`backend/.cantina_secret.key`, or set `CYBERCANTINA_SECRET_KEY`), so back that file up with your database. You can also use the built-in **Heuristic / Mock Offline Fallback** to test the full 5-phase pipeline without an active LLM server.

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later** ([AGPL-3.0-or-later](LICENSE)).

Commercial use is permitted under the terms of the AGPLv3: anyone who distributes or runs CyberCantina over a network must provide the complete source code, including all modifications and customizations.

