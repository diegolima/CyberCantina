import type {
  AgentDispatchMode,
  CampaignStateBundle,
  CharacterAgentDelta,
  CognitionBlock,
  Phase3ProgressEventPayload,
  Phase4AgentKind,
  Phase5ProgressEventPayload,
  PreTurnAnalysis,
  RecalledMemoryItem,
  TurnNodeRecord,
  TurnSubmitOptions,
  WorldPostTurnDelta,
} from "../types";
import {
  API_BASE,
  notifyUnauthorized,
  buildAuthHeaders,
  parseApiErrorText,
} from "./client";

export interface Phase4ProgressEventPayload {
  turn_id: string;
  dispatch_mode?: AgentDispatchMode | null;
  roster?: Array<{
    agent_key: string;
    kind: Phase4AgentKind;
    label: string;
  }> | null;
  agent_key?: string | null;
  kind?: Phase4AgentKind | null;
  label?: string | null;
  world_delta?: WorldPostTurnDelta | null;
  character_delta?: CharacterAgentDelta | null;
  contested_agent_keys?: string[] | null;
  error?: string | null;
}

export interface TurnStreamCallbacks {
  onChoicesAdjusted?: (data: { dropped_character_ids: string[] }) => void;
  onPhase1Complete?: (data: {
    pre_turn: PreTurnAnalysis;
    recalled_items: RecalledMemoryItem[];
  }) => void;
  onCognitionDelta?: (rawBuffer: string) => void;
  onCognitionComplete?: (cognition: CognitionBlock) => void;
  onPhase3Start?: (data: Phase3ProgressEventPayload) => void;
  onPhase3AgentStart?: (data: Phase3ProgressEventPayload) => void;
  onPhase3AgentComplete?: (data: Phase3ProgressEventPayload) => void;
  onPhase3AgentError?: (data: Phase3ProgressEventPayload) => void;
  onPhase3Complete?: (data: Phase3ProgressEventPayload) => void;
  onProseDelta?: (delta: string) => void;
  onTurnSaved?: (turn: TurnNodeRecord) => void;
  onPhase5Start?: (data: Phase5ProgressEventPayload) => void;
  onPhase5AgentStart?: (data: Phase5ProgressEventPayload) => void;
  onPhase5AgentComplete?: (data: Phase5ProgressEventPayload) => void;
  onPhase5AgentError?: (data: Phase5ProgressEventPayload) => void;
  onPhase5ArbitrationStart?: (data: Phase5ProgressEventPayload) => void;
  onPhase5Complete?: (data: {
    turn: TurnNodeRecord;
    state_bundle: CampaignStateBundle;
  }) => void;
  onPhase4Start?: (data: Phase4ProgressEventPayload) => void;
  onPhase4AgentStart?: (data: Phase4ProgressEventPayload) => void;
  onPhase4AgentComplete?: (data: Phase4ProgressEventPayload) => void;
  onPhase4AgentError?: (data: Phase4ProgressEventPayload) => void;
  onPhase4ArbitrationStart?: (data: Phase4ProgressEventPayload) => void;
  onPhase4Complete?: (data: {
    turn: TurnNodeRecord;
    state_bundle: CampaignStateBundle;
  }) => void;
  onError?: (err: string) => void;
}

export async function streamCampaignTurn(
  campaignId: string,
  payload: TurnSubmitOptions,
  callbacks: TurnStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/turns/stream`, {
    method: "POST",
    credentials: "include",
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    if (response.status === 401) {
      notifyUnauthorized();
    }
    throw new Error(`Stream failed (${response.status}): ${parseApiErrorText(response.status, text)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventName = "message";
      let dataJson = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataJson += line.slice("data:".length).trim();
        }
      }
      if (!dataJson) continue;
      const parsed = JSON.parse(dataJson);

      switch (eventName) {
        case "choices_adjusted":
          callbacks.onChoicesAdjusted?.(parsed);
          break;
        case "phase1_complete":
          callbacks.onPhase1Complete?.(parsed);
          break;
        case "phase3_start":
          callbacks.onPhase3Start?.(parsed);
          break;
        case "phase3_agent_start":
          callbacks.onPhase3AgentStart?.(parsed);
          break;
        case "phase3_agent_complete":
          callbacks.onPhase3AgentComplete?.(parsed);
          break;
        case "phase3_agent_error":
          callbacks.onPhase3AgentError?.(parsed);
          break;
        case "phase3_complete":
          callbacks.onPhase3Complete?.(parsed);
          break;
        case "cognition_delta":
          callbacks.onCognitionDelta?.(parsed.raw_buffer);
          break;
        case "cognition_complete":
          callbacks.onCognitionComplete?.(parsed);
          break;
        case "prose_delta":
          callbacks.onProseDelta?.(parsed.delta);
          break;
        case "turn_saved":
          callbacks.onTurnSaved?.(parsed);
          break;
        case "phase5_start":
          callbacks.onPhase5Start?.(parsed);
          callbacks.onPhase4Start?.(parsed);
          break;
        case "phase5_agent_start":
          callbacks.onPhase5AgentStart?.(parsed);
          callbacks.onPhase4AgentStart?.(parsed);
          break;
        case "phase5_agent_complete":
          callbacks.onPhase5AgentComplete?.(parsed);
          callbacks.onPhase4AgentComplete?.(parsed);
          break;
        case "phase5_agent_error":
          callbacks.onPhase5AgentError?.(parsed);
          callbacks.onPhase4AgentError?.(parsed);
          break;
        case "phase5_arbitration_start":
          callbacks.onPhase5ArbitrationStart?.(parsed);
          callbacks.onPhase4ArbitrationStart?.(parsed);
          break;
        case "phase5_complete":
          callbacks.onPhase5Complete?.(parsed);
          callbacks.onPhase4Complete?.(parsed);
          break;
        case "phase4_start":
          callbacks.onPhase4Start?.(parsed);
          break;
        case "phase4_agent_start":
          callbacks.onPhase4AgentStart?.(parsed);
          break;
        case "phase4_agent_complete":
          callbacks.onPhase4AgentComplete?.(parsed);
          break;
        case "phase4_agent_error":
          callbacks.onPhase4AgentError?.(parsed);
          break;
        case "phase4_arbitration_start":
          callbacks.onPhase4ArbitrationStart?.(parsed);
          break;
        case "phase4_complete":
          callbacks.onPhase4Complete?.(parsed);
          break;
        case "error":
          callbacks.onError?.(parsed.error || "Unknown stream error");
          break;
      }
    }
  }
}
