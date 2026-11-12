import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, getRelayTabId, getStoredSessionToken } from "../api";
import { runBrowserOllamaChat, probeBrowserOllama } from "../local/ollamaDriver";
import {
  ContextClampNotice,
  RelayLlmRequest,
  RelayProbeRequest,
  WebGpuProgress,
} from "../local/types";
import { checkWebGpuAdapter, getWebGpuModelInfos } from "../local/webgpuCatalog";
import { webGpuDriver } from "../local/webgpuDriver";
import { LLMProvider, UserProfile } from "../types";

export type RelayWsState = "idle" | "connecting" | "connected" | "reconnecting";

export interface LocalRelayContextValue {
  wsState: RelayWsState;
  hasBrowserProviders: boolean;
  allProviders: LLMProvider[];
  browserProviders: LLMProvider[];
  activeJobs: number;
  webgpuSupported: boolean | null;
  webgpuError: string | null;
  webgpuLoadedModel: string | null;
  webgpuProgress: WebGpuProgress | null;
  clampNotice: ContextClampNotice | null;
  dismissClampNotice: () => void;
  preloadWebGpu: (model: string, contextSize?: number | null) => Promise<void>;
  unloadWebGpu: () => Promise<void>;
  refreshProviders: () => Promise<void>;
  ensureConnected: () => void;
}

const LocalRelayContext = createContext<LocalRelayContextValue | null>(null);

export function useLocalRelay(): LocalRelayContextValue {
  const ctx = useContext(LocalRelayContext);
  if (!ctx) {
    throw new Error("useLocalRelay must be used inside <LocalRelayProvider>.");
  }
  return ctx;
}

export function useOptionalLocalRelay(): LocalRelayContextValue | null {
  return useContext(LocalRelayContext);
}

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const tabId = encodeURIComponent(getRelayTabId());
  return `${proto}//${window.location.host}/api/local-relay/ws?tab_id=${tabId}`;
}

export const LocalRelayProvider: React.FC<{
  currentUser: UserProfile | null;
  children: React.ReactNode;
}> = ({ currentUser, children }) => {
  const [allProviders, setAllProviders] = useState<LLMProvider[]>([]);
  const [browserProviders, setBrowserProviders] = useState<LLMProvider[]>([]);
  const [forceConnect, setForceConnect] = useState(false);
  const [wsState, setWsState] = useState<RelayWsState>("idle");
  const [activeJobs, setActiveJobs] = useState(0);
  const [webgpuSupported, setWebgpuSupported] = useState<boolean | null>(null);
  const [webgpuError, setWebgpuError] = useState<string | null>(null);
  const [webgpuLoadedModel, setWebgpuLoadedModel] = useState<string | null>(() =>
    webGpuDriver.getLoadedModel()
  );
  const [webgpuProgress, setWebgpuProgress] = useState<WebGpuProgress | null>(null);
  const [clampNotice, setClampNotice] = useState<ContextClampNotice | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const inflightRef = useRef<Map<string, AbortController>>(new Map());
  const mountedRef = useRef(true);
  const webgpuCapRef = useRef<{ supported: boolean; reason?: string }>({ supported: false });

  const hasBrowserProviders = browserProviders.some((p) => p.is_enabled && p.usable);
  const shouldConnect = Boolean(currentUser && (hasBrowserProviders || forceConnect));

  const refreshProviders = useCallback(async () => {
    if (!currentUser) {
      setAllProviders([]);
      setBrowserProviders([]);
      return;
    }
    try {
      const list = await api.listProviders();
      if (!mountedRef.current) return;
      setAllProviders(list);
      setBrowserProviders(
        list.filter((p) => p.type === "browser_ollama" || p.type === "webgpu")
      );
    } catch {
      // ignore transient provider fetch errors
    }
  }, [currentUser]);

  const ensureConnected = useCallback(() => {
    setForceConnect(true);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  useEffect(() => {
    let cancelled = false;
    void checkWebGpuAdapter().then((res) => {
      if (cancelled || !mountedRef.current) return;
      webgpuCapRef.current = res;
      setWebgpuSupported(res.supported);
      setWebgpuError(res.reason || null);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "relay.hello",
            webgpu_supported: res.supported,
            webgpu_error: res.reason || null,
            loaded_webgpu_model: webGpuDriver.getLoadedModel(),
          })
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return webGpuDriver.subscribe({
      onProgress: (p) => {
        if (mountedRef.current) setWebgpuProgress(p);
      },
      onLoadedModelChange: (m) => {
        if (mountedRef.current) {
          setWebgpuLoadedModel(m);
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "relay.hello",
                webgpu_supported: webgpuCapRef.current.supported,
                webgpu_error: webgpuCapRef.current.reason || null,
                loaded_webgpu_model: m,
              })
            );
          }
        }
      },
      onContextClamped: (notice) => {
        if (mountedRef.current) setClampNotice(notice);
      },
    });
  }, []);

  // Warn before closing tab if a browser-local generation is in progress.
  useEffect(() => {
    if (activeJobs <= 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [activeJobs]);

  useEffect(() => {
    if (!shouldConnect) {
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      setWsState("idle");
      return;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const sendJson = (ws: WebSocket, payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    const handleLlmRequest = async (ws: WebSocket, req: RelayLlmRequest) => {
      const controller = new AbortController();
      inflightRef.current.set(req.request_id, controller);
      setActiveJobs((n) => n + 1);
      try {
        const emitChunk = (delta: string) => {
          sendJson(ws, { type: "llm.chunk", request_id: req.request_id, delta });
        };
        const result =
          req.driver === "webgpu"
            ? await webGpuDriver.run(req, emitChunk, controller.signal)
            : await runBrowserOllamaChat(req, emitChunk, controller.signal);

        sendJson(ws, {
          type: "llm.done",
          request_id: req.request_id,
          content: result.content,
          thinking: result.thinking || "",
          done_reason: result.done_reason || null,
        });
      } catch (err: any) {
        if (!controller.signal.aborted) {
          const msg = String(err?.message || "Local browser inference failed.");
          const lower = msg.toLowerCase();
          let code = "inference_failed";
          if (req.driver === "webgpu" && (lower.includes("webgpu") || lower.includes("adapter"))) {
            code = "webgpu_unsupported";
          } else if (lower.includes("not installed") || lower.includes("model") && lower.includes("not found")) {
            code = "model_not_found";
          } else if (err instanceof TypeError || lower.includes("failed to fetch") || lower.includes("networkerror")) {
            code = "cors_or_network_error";
          }
          sendJson(ws, {
            type: "llm.error",
            request_id: req.request_id,
            code,
            message: msg,
          });
        }
      } finally {
        inflightRef.current.delete(req.request_id);
        if (mountedRef.current) {
          setActiveJobs((n) => Math.max(0, n - 1));
        }
      }
    };

    const handleProbeRequest = async (ws: WebSocket, req: RelayProbeRequest) => {
      if (req.driver === "webgpu") {
        const check = await checkWebGpuAdapter();
        webgpuCapRef.current = check;
        if (mountedRef.current) {
          setWebgpuSupported(check.supported);
          setWebgpuError(check.reason || null);
        }
        sendJson(ws, {
          type: "probe.result",
          request_id: req.request_id,
          reachable: check.supported,
          protocol: check.supported ? "openai_compat" : null,
          models: check.supported ? getWebGpuModelInfos() : [],
          error_code: check.supported ? null : "webgpu_unsupported",
          error: check.supported ? null : check.reason || "WebGPU is unavailable.",
        });
        return;
      }

      const res = await probeBrowserOllama(req.base_url);
      sendJson(ws, {
        type: "probe.result",
        request_id: req.request_id,
        reachable: res.reachable,
        protocol: res.protocol,
        models: res.models,
        error_code: res.error_code,
        error: res.error,
      });
    };

    const connect = () => {
      if (disposed) return;
      setWsState(attempt === 0 ? "connecting" : "reconnecting");
      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close(1000);
          return;
        }
        attempt = 0;
        setWsState("connected");
        const token = getStoredSessionToken();
        if (token) {
          sendJson(ws, { type: "relay.auth", token });
        }
        sendJson(ws, {
          type: "relay.hello",
          webgpu_supported: webgpuCapRef.current.supported,
          webgpu_error: webgpuCapRef.current.reason || null,
          loaded_webgpu_model: webGpuDriver.getLoadedModel(),
        });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "relay.ping") {
            sendJson(ws, { type: "relay.pong", ts: msg.ts });
          } else if (msg.type === "llm.request") {
            void handleLlmRequest(ws, msg as RelayLlmRequest);
          } else if (msg.type === "llm.cancel") {
            const ctrl = inflightRef.current.get(String(msg.request_id || ""));
            ctrl?.abort();
          } else if (msg.type === "probe.request") {
            void handleProbeRequest(ws, msg as RelayProbeRequest);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        for (const ctrl of inflightRef.current.values()) {
          ctrl.abort();
        }
        inflightRef.current.clear();
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        if (disposed) return;
        attempt += 1;
        const delayMs = Math.min(15000, 1000 * Math.pow(2, Math.min(attempt, 4)));
        setWsState("reconnecting");
        reconnectTimer = window.setTimeout(connect, delayMs);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      for (const ctrl of inflightRef.current.values()) {
        ctrl.abort();
      }
      inflightRef.current.clear();
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };
  }, [shouldConnect]);

  const dismissClampNotice = useCallback(() => setClampNotice(null), []);
  const preloadWebGpu = useCallback(async (model: string, contextSize?: number | null) => {
    await webGpuDriver.preload(model, contextSize);
  }, []);
  const unloadWebGpu = useCallback(async () => {
    await webGpuDriver.unload();
  }, []);

  const value = useMemo<LocalRelayContextValue>(
    () => ({
      wsState,
      hasBrowserProviders,
      allProviders,
      browserProviders,
      activeJobs,
      webgpuSupported,
      webgpuError,
      webgpuLoadedModel,
      webgpuProgress,
      clampNotice,
      dismissClampNotice,
      preloadWebGpu,
      unloadWebGpu,
      refreshProviders,
      ensureConnected,
    }),
    [
      wsState,
      hasBrowserProviders,
      allProviders,
      browserProviders,
      activeJobs,
      webgpuSupported,
      webgpuError,
      webgpuLoadedModel,
      webgpuProgress,
      clampNotice,
      dismissClampNotice,
      preloadWebGpu,
      unloadWebGpu,
      refreshProviders,
      ensureConnected,
    ]
  );

  return (
    <LocalRelayContext.Provider value={value}>
      {children}
      {(webgpuProgress || clampNotice) && (
        <div className="local-relay-toast-stack" role="status" aria-live="polite">
          {webgpuProgress && (
            <div className="local-relay-toast local-relay-toast--progress">
              <div className="local-relay-toast-title">
                Loading WebGPU Model · {Math.round(webgpuProgress.progress * 100)}%
              </div>
              <div className="local-relay-toast-sub">{webgpuProgress.text}</div>
              <div className="local-relay-progress-bar">
                <div
                  className="local-relay-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(2, Math.round(webgpuProgress.progress * 100)))}%` }}
                />
              </div>
            </div>
          )}
          {clampNotice && (
            <div className="local-relay-toast local-relay-toast--warn">
              <div className="local-relay-toast-row">
                <div className="local-relay-toast-title">WebGPU Context Clamped</div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: "1px 6px", fontSize: "0.7rem" }}
                  onClick={dismissClampNotice}
                >
                  Dismiss
                </button>
              </div>
              <div className="local-relay-toast-sub">
                <strong>{clampNotice.model}</strong> was capped from{" "}
                {clampNotice.requestedContext} to {clampNotice.effectiveContext} tokens to fit
                browser VRAM limits.
              </div>
            </div>
          )}
        </div>
      )}
    </LocalRelayContext.Provider>
  );
};
