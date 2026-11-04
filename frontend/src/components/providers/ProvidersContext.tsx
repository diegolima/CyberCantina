import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../api";
import {
  LLMProvider,
  ProviderCreatePayload,
  ProviderProbeResponse,
  ProviderUpdatePayload,
} from "../../types";

/** Client-side safety net; the server enforces its own 3 s probe timeout. */
const PROBE_CLIENT_TIMEOUT_MS = 8000;
const PROBE_CONCURRENCY = 4;

export interface ProviderStatus {
  state: "unknown" | "probing" | "connected" | "unreachable";
  result?: ProviderProbeResponse;
  /** Provider version this status belongs to; results for older versions are discarded. */
  forVersion: number;
}

export interface ProvidersStore {
  providers: LLMProvider[];
  status: Record<string, ProviderStatus>;
  loading: boolean;
  loadError: string | null;
  byId: (id: string | null | undefined) => LLMProvider | undefined;
  refresh: () => Promise<void>;
  probe: (id: string, opts?: { force?: boolean }) => Promise<void>;
  probeAll: (opts?: { force?: boolean }) => Promise<void>;
  create: (payload: ProviderCreatePayload) => Promise<LLMProvider>;
  update: (id: string, payload: ProviderUpdatePayload) => Promise<LLMProvider>;
  remove: (id: string) => Promise<void>;
}

const ProvidersContext = createContext<ProvidersStore | null>(null);

/**
 * Single source of truth for providers and their live status. Every tab that shows providers
 * (management cards, model pickers) reads this store, so edits/deletes are reflected everywhere.
 */
export const ProvidersProvider: React.FC<{
  children: React.ReactNode;
  /**
   * Whether this store may probe system providers. The admin area does; the user profile does
   * not (users only see the last server-side status and cannot trigger connections).
   */
  probeSystem?: boolean;
}> = ({ children, probeSystem = true }) => {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [status, setStatus] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const providersRef = useRef<LLMProvider[]>([]);
  const inflight = useRef<Map<string, AbortController>>(new Map());
  const mounted = useRef(true);

  const commitProviders = useCallback((next: LLMProvider[]) => {
    providersRef.current = next;
    setProviders(next);
  }, []);

  const abortProbe = useCallback((id: string) => {
    inflight.current.get(id)?.abort();
    inflight.current.delete(id);
  }, []);

  const probe = useCallback(
    async (id: string, opts?: { force?: boolean }) => {
      const target = providersRef.current.find((p) => p.id === id);
      if (!target) return;
      if (!probeSystem && target.scope === "system") return;
      abortProbe(id);
      const controller = new AbortController();
      inflight.current.set(id, controller);
      const timer = setTimeout(() => controller.abort(), PROBE_CLIENT_TIMEOUT_MS);
      const version = target.version;
      setStatus((s) => ({ ...s, [id]: { state: "probing", forVersion: version, result: s[id]?.result } }));
      try {
        const result = await api.probeProvider(id, { force: opts?.force, signal: controller.signal });
        const current = providersRef.current.find((p) => p.id === id);
        // Drop stale answers: the provider was edited/removed while the request was in flight.
        if (!mounted.current || controller.signal.aborted || !current || current.version !== version) return;
        setStatus((s) => ({
          ...s,
          [id]: { state: result.reachable ? "connected" : "unreachable", result, forVersion: version },
        }));
      } catch {
        if (!mounted.current || controller.signal.aborted) {
          // Aborted by us: either superseded (a newer probe owns the status) or timed out.
          if (inflight.current.get(id) === controller && mounted.current) {
            setStatus((s) => ({ ...s, [id]: { state: "unreachable", forVersion: version } }));
          }
          return;
        }
        setStatus((s) => ({ ...s, [id]: { state: "unreachable", forVersion: version } }));
      } finally {
        clearTimeout(timer);
        if (inflight.current.get(id) === controller) inflight.current.delete(id);
      }
    },
    [abortProbe, probeSystem]
  );

  const probeAll = useCallback(
    async (opts?: { force?: boolean }) => {
      const queue = providersRef.current
        .filter((p) => p.is_enabled && p.usable && (probeSystem || p.scope !== "system"))
        .map((p) => p.id);
      const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          await probe(id, opts);
        }
      });
      await Promise.all(workers);
    },
    [probe, probeSystem]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listProviders();
      if (!mounted.current) return;
      commitProviders(list);
      setLoadError(null);
      setStatus((s) => {
        const next: Record<string, ProviderStatus> = {};
        for (const p of list) if (s[p.id]) next[p.id] = s[p.id];
        return next;
      });
    } catch (err: any) {
      if (mounted.current) setLoadError(err?.message || "Failed to load providers.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [commitProviders]);

  useEffect(() => {
    mounted.current = true;
    const controllers = inflight.current;
    (async () => {
      await refresh();
      if (mounted.current) await probeAll();
    })();
    return () => {
      mounted.current = false;
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback(
    async (payload: ProviderCreatePayload) => {
      const created = await api.createProvider(payload);
      commitProviders([...providersRef.current, created]);
      void probe(created.id, { force: true });
      return created;
    },
    [commitProviders, probe]
  );

  const update = useCallback(
    async (id: string, payload: ProviderUpdatePayload) => {
      abortProbe(id);
      const updated = await api.updateProvider(id, payload);
      commitProviders(providersRef.current.map((p) => (p.id === id ? updated : p)));
      setStatus((s) => ({ ...s, [id]: { state: "unknown", forVersion: updated.version } }));
      void probe(id, { force: true });
      return updated;
    },
    [abortProbe, commitProviders, probe]
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteProvider(id);
      abortProbe(id);
      commitProviders(providersRef.current.filter((p) => p.id !== id));
      setStatus((s) => {
        const { [id]: _removed, ...rest } = s;
        return rest;
      });
    },
    [abortProbe, commitProviders]
  );

  const byId = useCallback(
    (id: string | null | undefined) => (id ? providers.find((p) => p.id === id) : undefined),
    [providers]
  );

  const value = useMemo<ProvidersStore>(
    () => ({ providers, status, loading, loadError, byId, refresh, probe, probeAll, create, update, remove }),
    [providers, status, loading, loadError, byId, refresh, probe, probeAll, create, update, remove]
  );

  return <ProvidersContext.Provider value={value}>{children}</ProvidersContext.Provider>;
};

export function useProviders(): ProvidersStore {
  const ctx = useContext(ProvidersContext);
  if (!ctx) throw new Error("useProviders must be used inside <ProvidersProvider>.");
  return ctx;
}
