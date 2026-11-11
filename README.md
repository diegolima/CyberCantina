# CyberCantina

**CyberCantina** is a local-first, self-hosted AI roleplay engine built around living worlds, persistent character psychology, and tabletop storytelling tools.

> **Alpha Release:** CyberCantina is in active public alpha. Features, interfaces, and schemas are evolving quickly—feedback and bug reports are welcome in [GitHub Issues](https://github.com/diegolima/CyberCantina/issues).

---

## A Different Approach to AI Roleplay

Most AI roleplay interfaces rely solely on a chat transcript and a single prompt—so inventories, locations, passage of time, and character emotions only exist for as long as they stay inside recent text.

CyberCantina takes a different approach by giving your models a persistent world around the conversation:

* **Characters Think & Feel Over Time:** Behind every reply, characters evaluate the scene privately, carry persistent goals, and shift in mood, composure, trust, and grievances across your campaign rather than resetting emotionally every few messages.
* **Room Privacy & Private Whispers:** Characters only perceive events in the room they are standing in. Address specific characters privately or over remote comms with `@Character:` without leaking secrets to the rest of the cast.
* **Real State Outside the Prose:** Equipped items, carried inventory, connected rooms, travel times, and an advancing in-world clock stay tracked independently of the narrative text.
* **Branch-Safe Timelines:** Rewind, edit, or swipe any turn to explore *"what if"* paths without corrupting character memories, inventories, or relationships across branches.
* **Tabletop Directing Tools:** Let `d20` checks decide risky actions (`Auto`, `Forced`, or `Disabled`), steer character decisions with gated **Director Choices** (`/choice`), or pace scenes neutrally with **Narrator** commands (`/look`, `/wait`, `/complication`).

---

## Key Features

* **Built-In Showcase Campaign:** Start playing immediately with *Midnight at the Neon Rust* (Sector 9 & Kira Vance) already set up on first launch.
* **AI Creation Wizards & Magic Wand:** Turn brief concepts into interconnected multi-room worlds and deep characters with voice anchors, memories, and 8 dynamic emotion portrait slots.
* **Player Personas with Secrets:** Create player identities with custom gear and hidden backstory/items that characters only learn when revealed in-scene (or spread through witness gossip).
* **Import & Share:** Share exact, lossless `.zcc` bundles of worlds, characters, and personas—or import existing `.png` / `.json` character cards (experimental).
* **Live Inspector & Interactive Map:** Watch character moods, stances, recalled memories, and timeline branches in real time, or expand the zoomable map to edit rooms and fix drift.
* **Local, Cloud, or Hybrid Models:** Run 100% locally via Ollama or OpenAI-compatible servers, connect OpenRouter or AI Horde, mix a cloud **Actor** with a local `3B–8B` Ollama **Clerk** to cut token costs, or test without a GPU using built-in offline simulation.
* **Self-Hosted & Multi-User Ready:** Use passwordless single-user local mode or enable multi-user accounts with Argon2id passwords, WebAuthn Passkeys, and optional Bring Your Own Provider (BYOP) policies.

---

## Quick Start (Docker)

### 1. Download and Start

```bash
curl -O https://raw.githubusercontent.com/diegolima/CyberCantina/main/docker-compose.yml
docker compose up -d
```

Open **`http://localhost:3000`** in your browser.

To update to the latest alpha images later:

```bash
docker compose pull && docker compose up -d
```

### 2. First Launch Setup

1. **Create Your Admin Account:** Complete the **Initial Admin Setup** screen (leave the password blank for local single-user mode, or set a password for multi-user logins and passkeys).
2. **Connect a Provider:** Open **Admin Settings → Providers** and add your LLM server (Ollama, an OpenAI-compatible server, OpenRouter, or AI Horde).
3. **Pick Your Models:** Open **Admin Settings → Models** and select models for the **Actor** (prose) and **Clerk** (background state and character thinking).
   * *No LLM server yet?* Enable **Allow heuristic offline simulation if a provider is unreachable** under **Admin Settings → Models → LLM Resilience & Fallback** to explore the full interface offline.
4. **Start Playing:** Launch the built-in *Midnight at the Neon Rust* campaign from the Home screen, or create your own world and cast.

### Recommended Ollama Setup

CyberCantina pairs a creative **Actor** model with a lightweight **Clerk** model (for example `qwen2.5:3b` or `llama3.2:3b`). Keeping **at least two models loaded in memory** avoids slow model-swapping delays on every turn:

```bash
OLLAMA_MAX_LOADED_MODELS=2 ollama serve
```

* **Linux Docker note:** Allow your container to reach Ollama on the host with:
  ```bash
  OLLAMA_HOST=0.0.0.0:11434 OLLAMA_MAX_LOADED_MODELS=2 ollama serve
  ```
* **Tight VRAM or hybrid setups:** You can enable **Clerk Mirrors Actor** to share one model, offload the Clerk to CPU, or pair a cloud Actor with a local `3B–8B` Ollama Clerk (requiring only 1 local model loaded).

> Building from source or customizing `.env`? See **[Installation & Setup](https://github.com/diegolima/CyberCantina/wiki/Installation-and-Setup)** in the Wiki.

---

## Documentation & Wiki

Explore the **[CyberCantina Wiki](https://github.com/diegolima/CyberCantina/wiki)** for full user guides, hosting instructions, and technical architecture docs:

### Getting Started & Hosting
* [Installation & Setup](https://github.com/diegolima/CyberCantina/wiki/Installation-and-Setup) — Docker, building from source (`Python >= 3.14` & Node 22), environment variables, and backups.
* [Providers, Models & Embeddings](https://github.com/diegolima/CyberCantina/wiki/Providers-Models-and-Embeddings) — Ollama, OpenRouter, AI Horde, hybrid setups, and vector search tuning.
* [Authentication, Multi-User & Security](https://github.com/diegolima/CyberCantina/wiki/Authentication-Multi-User-and-Security) — Passwords, passkeys, BYOP policies, encryption at rest, and network safety.

### Playing & Authoring
* [First Campaign & Interface Tour](https://github.com/diegolima/CyberCantina/wiki/First-Campaign-and-Interface-Tour) — Home Deck, built-in showcase campaign, and workspace tour.
* [Authoring Worlds, Characters & Personas](https://github.com/diegolima/CyberCantina/wiki/Authoring-Worlds-Characters-and-Personas) — AI Wizards, Magic Wand, emotion portraits, lore, and player secrets.
* [Importing & Exporting](https://github.com/diegolima/CyberCantina/wiki/Importing-and-Exporting) — Experimental character card imports and lossless `.zcc` archives.
* [Playing, Directing & Mechanics](https://github.com/diegolima/CyberCantina/wiki/Playing-Directing-and-Mechanics) — `@Character:` whispers, Narrator slash commands, `/choice` directing, and `d20` tiers.
* [Live Inspector, Map & Timeline](https://github.com/diegolima/CyberCantina/wiki/Live-Inspector-Map-and-Timeline) — Interactive map editing, character dossiers, episodic summaries, and branch checkout.
* [Prompt Customization & Presets](https://github.com/diegolima/CyberCantina/wiki/Prompt-Customization-and-Presets) — Customizing templates and prompt presets.

### Architecture & Contributing
* [Core Vision & Philosophy](VISION.md) — High-level design tenets and community principles.
* [Architecture: 5-Phase Turn Pipeline](https://github.com/diegolima/CyberCantina/wiki/Architecture-Turn-Pipeline)
* [Architecture: Context, Memory & State](https://github.com/diegolima/CyberCantina/wiki/Architecture-Context-Memory-and-State)
* [Architecture: CARE Affective Engine](https://github.com/diegolima/CyberCantina/wiki/Architecture-CARE-Affective-Engine)
* [Developer Guide & Roadmap](https://github.com/diegolima/CyberCantina/wiki/Developer-Guide-and-Roadmap)

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later** ([AGPL-3.0-or-later](LICENSE)).

Commercial use is permitted under the terms of the AGPLv3: anyone who distributes or runs CyberCantina over a network must provide the complete source code, including all modifications and customizations.
