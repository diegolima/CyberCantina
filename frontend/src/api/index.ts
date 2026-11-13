import { authApi } from "./auth";
import { campaignsApi } from "./campaigns";
import { charactersApi } from "./characters";
import { importExportApi } from "./importExport";
import { notesApi } from "./notes";
import { personasApi } from "./personas";
import { promptsApi } from "./prompts";
import { providersApi } from "./providers";
import { settingsApi } from "./settings";
import { worldsApi } from "./worlds";

export {
  ApiError,
  getRelayTabId,
  getStoredSessionToken,
  setOnUnauthorizedHandler,
  setStoredSessionToken,
  triggerDownload,
} from "./client";
export {
  streamCampaignTurn,
  type Phase4ProgressEventPayload,
  type TurnStreamCallbacks,
} from "./stream";

export const api = {
  ...authApi,
  ...settingsApi,
  ...providersApi,
  ...promptsApi,
  ...notesApi,
  ...worldsApi,
  ...charactersApi,
  ...importExportApi,
  ...personasApi,
  ...campaignsApi,
};
