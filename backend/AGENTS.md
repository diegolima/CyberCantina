# Backend Affective Engine & Prompt Architecture Guidelines

## 1. Affective Engine Primacy in Narrative & Prompt Directives
When designing system prompts, actor directives, or specialized interaction protocols:
- **No Trope Overrides:** Never mandate blanket stylistic tropes, forced vulgarity, or mandatory physical behaviors that override character psychological states.
- **Relational Primacy:** Ground physical proximity, vulnerability, touch, and boundary-setting in active dyadic relations (Warmth, Trust, Grievance). High trust/warmth permits unhurried vulnerability; low trust/high grievance demands physical stiffness, vigilance, and defensive recoil.
- **Agency & Dominance:** Map conversational and physical initiative to `feeling_agency` and `dominance` ($D$). Characters with `commanding`/`assured` agency drive space and physical action; `pressured`/`helpless` characters yield space, hesitate, or act reactively.
- **Composure & Somatic Realism:** Physiological responses (respiration, vocal stability, micro-expressions, trembling) must strictly map to `composure`. High composure ($> 0.70$) enforces emotional masking and disciplined stillness; strained composure ($< 0.35$) mandates involuntary somatic leakage.
- **Safety & Boundary Realism:** In dangerous, hostile, or non-consensual interactions, characters retain authentic self-preservation and psychological agency based on their baseline combat capabilities and core fears. Never depict characters as passive puppets.

## 2. Cognition-to-Prose Context Assembly (Zone 4) Invariants
- **Full Categorical Preservation:** When serializing `<character_active_cognition>`, always preserve discrete categorical attributes on `<feeling>`:
  `tone="..." intensity="..." agency="..." threat="..." coping="..."`.
- **Mechanical Outcome Coupling:** If a mechanics check was resolved for a character, explicitly bind `roll_outcome="{tier}"` to the `<character_active_cognition>` tag so the Prose LLM cannot narrate success for a failed plan.
- **Dynamic Behavioral Anchors:** Synthesize Zone 4 `Behavioral Anchor` directives dynamically based on resolved critical roll tiers and calculated composure thresholds.
- **Ensemble Dyadic Hints:** Co-present background characters in `<other_characters_in_room>` must display their fast-forwarded outward demeanor and compact stances toward the Player and active speaker (`[Stance toward Player: ...]`).
- **Zero Raw Float Invariant:** Never inject raw floating-point numbers into prompts or Zone 4 context blocks. Always use deterministic lexical projections (`render_zone4_affective_block`, `describe_edge_stance`, `describe_trust_tier`).

## 3. Backend Testing Invariants
- **Virtualenv Execution:** Always execute backend tests using `backend/.venv/bin/pytest`. Never invoke naked `pytest`.
- **Async Fixtures:** Always decorate asynchronous test functions with `@pytest.mark.asyncio()`.
- **Mock LLM Network Calls in Tests:** When testing Phase 3 multi-cognition or Phase 5 clerk fusion, patch `llm_client.complete_structured` or `llm_client.stream_chat` to avoid network delays or offline timeouts.

## 4. Phase 3 Cognition & Prompt Architecture Invariants
- **Ceiling-Not-Quota Prompting:** When constraining cognitive fields (`<recall>`, `<plan>`), always specify upper limits with explicit anti-filler directives (e.g., *"Up to 2–3 concise bullet points... strictly under 12 words each; never pad with filler"*). Small/medium LLMs treat unqualified bullet counts as quotas, inventing hallucinated trivia when fewer items suffice.
- **No Blanket Memory Bans:** Never impose blanket negative bans like *"Never summarize backstory"* in cognition prompts. Absolute bans starve the model of narrative relevance. Allow concise, bounded recall of immediate triggers, backstory, or active secrets.
- **Defensive Leakage Sanitization:** Always pipe LLM cognition outputs through schema-level bullet/word capping (`_format_cognition_bullets`) and regex prompt-leakage sanitization (`_sanitize_cognition_text`). Never allow raw LLM output or echoed prompt templates to persist into turn snapshots, preventing cross-turn prompt-leak poisoning loops.

## 5. State Persistence & Pydantic Serialization Invariants
- **In-Memory Attribute Integrity:** State snapshots (e.g. `CharacterStateSnapshot`) must preserve Pydantic model instances (e.g., `PersonaKnowledgeProvenance`, `ItemInstance`) in dictionary fields in memory. Do not coerce them to raw `dict` in schema validators if downstream code or tests rely on attribute access (`prov.learned_from`).
- **Dedicated SQLite Serialization Helpers:** When persisting state snapshots with nested Pydantic objects to SQLite JSON columns, never rely on standard `json.dumps()`. Always route serialization through dedicated repository helpers (such as `_dump_provenance_json` or `dump_items_json`) that extract `.model_dump()` / `.dict()` prior to JSON encoding.
