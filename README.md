# CyberCantina

**CyberCantina** is an agentic AI roleplay framework designed as a next-generation successor to SillyTavern. Instead of treating LLMs as stateless text-completion wrappers, CyberCantina orchestrates a **4-Phase Cognitive Turn Pipeline**, a **Branch-Safe Spatial & World State Graph**, **3-Tier Episodic + Vector Memory**, and **AI Creation Wizards**.

## Core Architecture

1. **AI Authoring Wizards (`1.1 Character` & `1.2 World Graph`)**
   - **Character Wizard:** Expands brief character concepts into a static `core_persona`, `voice_anchors`, baseline psychological state (`valence`, `arousal`, `core_drive`, `core_fear`), and atomic `memory_shards` indexed directly into the semantic vector store.
   - **World & Spatial Graph Wizard:** Generates world rules, custom/ISO calendars, lore entries, and an initial topology of interconnected `LocationNode` and `LocationEdge` objects.
2. **Phase 1: Auxiliary Pre-Processor & Mechanics Engine (`phase1_pre.py`)**
   - Analyzes user sentiment/subtext, extracts referenced entities, generates semantic RAG queries, detects spatial movement intent, and triggers native **d20 RNG / Dice Mechanics** when risky actions are attempted.
3. **Phase 2: 4-Zone KV-Cache-Preserving Context Assembler (`phase2_context.py`)**
   - Keeps **Zone 1 (Static Prefix)** and **Zone 2 (Chunked Episodic Summaries)** strictly stable at the top of the prompt while injecting dynamic turn state (World Clock, 1-hop Spatial Neighbors, RAG memories, RNG results, and previous affect state) in **Zone 4 (Ephemeral Tail Frame)** to maximize KV-cache hit rates.
4. **Phase 3: Single-Pass `<cognition>` + Narrative Stream (`phase3_actor.py`)**
   - Guides the main model to emit a structured `<cognition>` block (`<recall>`, `<feeling>`, `<want>`, `<plan>`) immediately before narrative prose, streaming both over separate Server-Sent Event (SSE) channels in real time.
5. **Phase 4: Async Post-Turn Clerk & Branch-Safe State Engine (`phase4_clerk.py`)**
   - Runs asynchronously after generation to advance the **World Clock**, update character locations (or dynamically improvise and link newly discovered `LocationNode` rooms in the spatial graph), and compress overflowing working memory turns into **Episodic Chunks**.
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

Open `http://localhost:5173` to launch the CyberCantina Roleplay Studio. Configure your OpenAI-compatible endpoints (Ollama, `llama.cpp`, vLLM, LM Studio, OpenRouter, etc.) in the **Model Settings** panel, or use the built-in **Heuristic / Mock Offline Fallback** to test the full 4-phase pipeline without an active LLM server.

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later** ([AGPL-3.0-or-later](LICENSE)).

Commercial use is permitted under the terms of the AGPLv3: anyone who distributes or runs CyberCantina over a network must provide the complete source code, including all modifications and customizations.

