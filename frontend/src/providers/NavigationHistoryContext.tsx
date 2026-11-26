import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AppRoute,
  NavigationGuardPrompt,
  OverlayBackGuard,
  OverlayRegistration,
} from "../types";
import {
  buildHistoryNavState,
  computeOverlayReconcileAction,
  createNavSessionId,
  formatAppRoute,
  isStaleForwardOverlayState,
  parseAppRoute,
  parseHistoryNavState,
  routesEqual,
  sortOverlayStack,
} from "../utils/navigationHistory";

interface InternalOverlayEntry extends OverlayRegistration {
  seq: number;
}

export interface RouteExitGuard {
  isBlocked: boolean;
  guard: OverlayBackGuard;
}

type PendingGuardAction =
  | {
      kind: "overlay";
      overlayId: string;
      onConfirm: () => void;
    }
  | {
      kind: "route";
      targetRoute: AppRoute;
    };

export interface NavigationHistoryContextValue {
  route: AppRoute;
  getCurrentRoute: () => AppRoute;
  navigateTo: (nextRoute: AppRoute) => void;
  replaceRoute: (nextRoute: AppRoute) => void;
  setRouteGuard: (guard: RouteExitGuard | null) => void;
  registerOverlay: (registration: OverlayRegistration) => number;
  updateOverlay: (seq: number, patch: Partial<OverlayRegistration>) => void;
  unregisterOverlay: (seq: number) => void;
  requestOverlayClose: (seq: number) => void;
  guardPrompt: NavigationGuardPrompt | null;
  confirmGuard: () => void;
  cancelGuard: () => void;
}

const NavigationHistoryContext = createContext<NavigationHistoryContextValue | null>(
  null
);

const DEFAULT_OVERLAY_GUARD: Required<OverlayBackGuard> = {
  title: "Discard unsaved changes?",
  message:
    "You have unsaved changes. Are you sure you want to close and discard them?",
  confirmLabel: "Discard",
  cancelLabel: "Stay",
};

const DEFAULT_ROUTE_GUARD: Required<OverlayBackGuard> = {
  title: "Leave active campaign?",
  message:
    "An action is currently in progress. Leaving now will return to the Home screen.",
  confirmLabel: "Leave",
  cancelLabel: "Stay",
};

export const NavigationHistoryProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const sessionIdRef = useRef<string>(createNavSessionId());
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window !== "undefined"
      ? parseAppRoute(window.location.pathname)
      : { kind: "home" }
  );
  const routeRef = useRef<AppRoute>(route);
  const committedDepthRef = useRef<number>(0);
  const overlaysRef = useRef<InternalOverlayEntry[]>([]);
  const nextSeqRef = useRef<number>(0);
  const routeGuardRef = useRef<RouteExitGuard | null>(null);
  const pendingBackEventsRef = useRef<number>(0);
  const pendingRouteTransitionRef = useRef<{
    mode: "replace" | "sync";
    route: AppRoute;
  } | null>(null);
  const reconcileScheduledRef = useRef<boolean>(false);

  const [guardPrompt, setGuardPrompt] = useState<NavigationGuardPrompt | null>(
    null
  );
  const guardPromptRef = useRef<NavigationGuardPrompt | null>(null);
  const pendingGuardActionRef = useRef<PendingGuardAction | null>(null);

  const updateGuardPrompt = useCallback(
    (next: NavigationGuardPrompt | null) => {
      guardPromptRef.current = next;
      setGuardPrompt(next);
    },
    []
  );

  const reconcileHistoryNow = useCallback(() => {
    if (typeof window === "undefined") return;
    const sorted = sortOverlayStack(overlaysRef.current);
    const targetDepth = sorted.length;
    const topOverlay = targetDepth > 0 ? sorted[targetDepth - 1] : null;
    const committed = committedDepthRef.current;
    const action = computeOverlayReconcileAction(committed, targetDepth);
    const path = formatAppRoute(routeRef.current);

    if (action.kind === "push") {
      for (let i = 1; i <= action.count; i += 1) {
        const depth = committed + i;
        const entryAtDepth = sorted[depth - 1] ?? topOverlay;
        window.history.pushState(
          buildHistoryNavState(
            sessionIdRef.current,
            routeRef.current,
            depth,
            entryAtDepth?.id ?? null
          ),
          "",
          path
        );
      }
      committedDepthRef.current = targetDepth;
      return;
    }

    if (action.kind === "replace") {
      window.history.replaceState(
        buildHistoryNavState(
          sessionIdRef.current,
          routeRef.current,
          targetDepth,
          topOverlay?.id ?? null
        ),
        "",
        path
      );
      return;
    }

    if (action.kind === "pop") {
      committedDepthRef.current = targetDepth;
      pendingBackEventsRef.current += 1;
      window.history.go(-action.delta);
    }
  }, []);

  const scheduleReconcile = useCallback(() => {
    if (typeof window === "undefined") return;
    if (reconcileScheduledRef.current) return;
    reconcileScheduledRef.current = true;
    queueMicrotask(() => {
      reconcileScheduledRef.current = false;
      reconcileHistoryNow();
    });
  }, [reconcileHistoryNow]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initialRoute = parseAppRoute(window.location.pathname);
    routeRef.current = initialRoute;
    setRoute(initialRoute);
    committedDepthRef.current = 0;
    window.history.replaceState(
      buildHistoryNavState(sessionIdRef.current, initialRoute, 0, null),
      "",
      formatAppRoute(initialRoute)
    );

    const handlePopState = (event: PopStateEvent) => {
      if (pendingRouteTransitionRef.current) {
        const transition = pendingRouteTransitionRef.current;
        pendingRouteTransitionRef.current = null;
        if (pendingBackEventsRef.current > 0) {
          pendingBackEventsRef.current -= 1;
        }
        if (transition.mode === "replace") {
          window.history.replaceState(
            buildHistoryNavState(sessionIdRef.current, transition.route, 0, null),
            "",
            formatAppRoute(transition.route)
          );
        }
        routeRef.current = transition.route;
        committedDepthRef.current = 0;
        setRoute(transition.route);
        return;
      }

      if (pendingBackEventsRef.current > 0) {
        pendingBackEventsRef.current -= 1;
        return;
      }

      const nextState = parseHistoryNavState(event.state);
      const nextRoute = nextState?.route ?? parseAppRoute(window.location.pathname);

      // Keep existing confirmation prompt on top if user presses Back again.
      if (guardPromptRef.current) {
        const sorted = sortOverlayStack(overlaysRef.current);
        const top = sorted.length > 0 ? sorted[sorted.length - 1] : null;
        window.history.pushState(
          buildHistoryNavState(
            sessionIdRef.current,
            routeRef.current,
            committedDepthRef.current,
            top?.id ?? null
          ),
          "",
          formatAppRoute(routeRef.current)
        );
        return;
      }

      // Forward hygiene: never resurrect closed or foreign-session overlays.
      if (
        isStaleForwardOverlayState(
          nextState,
          sessionIdRef.current,
          committedDepthRef.current,
          overlaysRef.current.length
        )
      ) {
        window.history.replaceState(
          buildHistoryNavState(sessionIdRef.current, nextRoute, 0, null),
          "",
          formatAppRoute(nextRoute)
        );
        if (!routesEqual(nextRoute, routeRef.current)) {
          routeRef.current = nextRoute;
          committedDepthRef.current = 0;
          setRoute(nextRoute);
        }
        return;
      }

      // Dismiss active overlays LIFO before exiting the current route.
      if (overlaysRef.current.length > 0 && committedDepthRef.current > 0) {
        const landedDepth =
          nextState &&
          nextState.sessionId === sessionIdRef.current &&
          routesEqual(nextState.route, routeRef.current)
            ? nextState.overlayDepth
            : 0;

        if (landedDepth < committedDepthRef.current) {
          const sorted = sortOverlayStack(overlaysRef.current);
          const top = sorted[sorted.length - 1];
          if (top?.isDirty) {
            window.history.pushState(
              buildHistoryNavState(
                sessionIdRef.current,
                routeRef.current,
                committedDepthRef.current,
                top.id
              ),
              "",
              formatAppRoute(routeRef.current)
            );
            const g = top.guard;
            pendingGuardActionRef.current = {
              kind: "overlay",
              overlayId: top.id,
              onConfirm: top.onClose,
            };
            updateGuardPrompt({
              kind: "overlay",
              title: g?.title ?? DEFAULT_OVERLAY_GUARD.title,
              message: g?.message ?? DEFAULT_OVERLAY_GUARD.message,
              confirmLabel: g?.confirmLabel ?? DEFAULT_OVERLAY_GUARD.confirmLabel,
              cancelLabel: g?.cancelLabel ?? DEFAULT_OVERLAY_GUARD.cancelLabel,
            });
            return;
          }

          const toClose: InternalOverlayEntry[] = [];
          let remainingDepth = committedDepthRef.current;
          for (let idx = sorted.length - 1; idx >= 0 && remainingDepth > landedDepth; idx -= 1) {
            const candidate = sorted[idx];
            if (candidate.isDirty && toClose.length > 0) {
              break;
            }
            toClose.push(candidate);
            remainingDepth = Math.max(0, remainingDepth - 1);
          }

          committedDepthRef.current = remainingDepth;
          for (const item of toClose) {
            item.onClose();
          }

          if (
            !routesEqual(nextRoute, routeRef.current) &&
            remainingDepth === 0 &&
            !(routeGuardRef.current?.isBlocked && routeRef.current.kind === "campaign")
          ) {
            routeRef.current = nextRoute;
            setRoute(nextRoute);
          }
          return;
        }
      }

      // Route-level Back / Forward transition.
      if (!routesEqual(nextRoute, routeRef.current)) {
        if (
          routeRef.current.kind === "campaign" &&
          nextRoute.kind === "home" &&
          routeGuardRef.current?.isBlocked
        ) {
          window.history.pushState(
            buildHistoryNavState(sessionIdRef.current, routeRef.current, 0, null),
            "",
            formatAppRoute(routeRef.current)
          );
          const g = routeGuardRef.current.guard;
          pendingGuardActionRef.current = {
            kind: "route",
            targetRoute: nextRoute,
          };
          updateGuardPrompt({
            kind: "route",
            title: g.title || DEFAULT_ROUTE_GUARD.title,
            message: g.message || DEFAULT_ROUTE_GUARD.message,
            confirmLabel: g.confirmLabel ?? DEFAULT_ROUTE_GUARD.confirmLabel,
            cancelLabel: g.cancelLabel ?? DEFAULT_ROUTE_GUARD.cancelLabel,
          });
          return;
        }

        routeRef.current = nextRoute;
        committedDepthRef.current = 0;
        setRoute(nextRoute);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [updateGuardPrompt]);

  const getCurrentRoute = useCallback(() => routeRef.current, []);

  const navigateTo = useCallback(
    (nextRoute: AppRoute) => {
      pendingGuardActionRef.current = null;
      updateGuardPrompt(null);
      if (typeof window === "undefined") {
        routeRef.current = nextRoute;
        setRoute(nextRoute);
        return;
      }

      const depth = committedDepthRef.current;
      if (routesEqual(routeRef.current, nextRoute) && depth === 0) {
        return;
      }

      const nextPath = formatAppRoute(nextRoute);
      if (depth === 0) {
        window.history.pushState(
          buildHistoryNavState(sessionIdRef.current, nextRoute, 0, null),
          "",
          nextPath
        );
        routeRef.current = nextRoute;
        setRoute(nextRoute);
        return;
      }

      if (depth === 1) {
        window.history.replaceState(
          buildHistoryNavState(sessionIdRef.current, nextRoute, 0, null),
          "",
          nextPath
        );
        committedDepthRef.current = 0;
        routeRef.current = nextRoute;
        setRoute(nextRoute);
        return;
      }

      pendingRouteTransitionRef.current = { mode: "replace", route: nextRoute };
      pendingBackEventsRef.current += 1;
      committedDepthRef.current = 0;
      window.history.go(-(depth - 1));
    },
    [updateGuardPrompt]
  );

  const replaceRoute = useCallback(
    (nextRoute: AppRoute) => {
      pendingGuardActionRef.current = null;
      updateGuardPrompt(null);
      if (typeof window === "undefined") {
        routeRef.current = nextRoute;
        setRoute(nextRoute);
        return;
      }

      const depth = committedDepthRef.current;
      const nextPath = formatAppRoute(nextRoute);
      if (depth === 0) {
        window.history.replaceState(
          buildHistoryNavState(sessionIdRef.current, nextRoute, 0, null),
          "",
          nextPath
        );
        routeRef.current = nextRoute;
        setRoute(nextRoute);
        return;
      }

      pendingRouteTransitionRef.current = { mode: "replace", route: nextRoute };
      pendingBackEventsRef.current += 1;
      committedDepthRef.current = 0;
      window.history.go(-depth);
    },
    [updateGuardPrompt]
  );

  const setRouteGuard = useCallback((guard: RouteExitGuard | null) => {
    routeGuardRef.current = guard;
  }, []);

  const registerOverlay = useCallback(
    (registration: OverlayRegistration): number => {
      const seq = ++nextSeqRef.current;
      overlaysRef.current = [...overlaysRef.current, { ...registration, seq }];
      scheduleReconcile();
      return seq;
    },
    [scheduleReconcile]
  );

  const updateOverlay = useCallback(
    (seq: number, patch: Partial<OverlayRegistration>) => {
      overlaysRef.current = overlaysRef.current.map((entry) =>
        entry.seq === seq ? { ...entry, ...patch } : entry
      );
    },
    []
  );

  const unregisterOverlay = useCallback(
    (seq: number) => {
      const next = overlaysRef.current.filter((entry) => entry.seq !== seq);
      if (next.length === overlaysRef.current.length) return;
      overlaysRef.current = next;
      scheduleReconcile();
    },
    [scheduleReconcile]
  );

  const requestOverlayClose = useCallback(
    (seq: number) => {
      const entry = overlaysRef.current.find((item) => item.seq === seq);
      if (!entry) return;
      if (entry.isDirty) {
        const g = entry.guard;
        pendingGuardActionRef.current = {
          kind: "overlay",
          overlayId: entry.id,
          onConfirm: entry.onClose,
        };
        updateGuardPrompt({
          kind: "overlay",
          title: g?.title ?? DEFAULT_OVERLAY_GUARD.title,
          message: g?.message ?? DEFAULT_OVERLAY_GUARD.message,
          confirmLabel: g?.confirmLabel ?? DEFAULT_OVERLAY_GUARD.confirmLabel,
          cancelLabel: g?.cancelLabel ?? DEFAULT_OVERLAY_GUARD.cancelLabel,
        });
        return;
      }
      entry.onClose();
    },
    [updateGuardPrompt]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasDirtyOverlay = overlaysRef.current.some((entry) => entry.isDirty);
      const hasBlockedRoute = Boolean(routeGuardRef.current?.isBlocked);
      if (hasDirtyOverlay || hasBlockedRoute) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const cancelGuard = useCallback(() => {
    pendingGuardActionRef.current = null;
    updateGuardPrompt(null);
  }, [updateGuardPrompt]);

  const confirmGuard = useCallback(() => {
    const action = pendingGuardActionRef.current;
    pendingGuardActionRef.current = null;
    updateGuardPrompt(null);
    if (!action) return;

    if (action.kind === "overlay") {
      action.onConfirm();
      return;
    }

    if (typeof window === "undefined") {
      routeRef.current = action.targetRoute;
      setRoute(action.targetRoute);
      return;
    }

    pendingRouteTransitionRef.current = {
      mode: "sync",
      route: action.targetRoute,
    };
    pendingBackEventsRef.current += 1;
    window.history.go(-1);
  }, [updateGuardPrompt]);

  const value = useMemo<NavigationHistoryContextValue>(
    () => ({
      route,
      getCurrentRoute,
      navigateTo,
      replaceRoute,
      setRouteGuard,
      registerOverlay,
      updateOverlay,
      unregisterOverlay,
      requestOverlayClose,
      guardPrompt,
      confirmGuard,
      cancelGuard,
    }),
    [
      route,
      getCurrentRoute,
      navigateTo,
      replaceRoute,
      setRouteGuard,
      registerOverlay,
      updateOverlay,
      unregisterOverlay,
      requestOverlayClose,
      guardPrompt,
      confirmGuard,
      cancelGuard,
    ]
  );

  return (
    <NavigationHistoryContext.Provider value={value}>
      {children}
    </NavigationHistoryContext.Provider>
  );
};

export function useOptionalNavigationHistory(): NavigationHistoryContextValue | null {
  return useContext(NavigationHistoryContext);
}

export function useNavigationHistory(): NavigationHistoryContextValue {
  const ctx = useContext(NavigationHistoryContext);
  if (!ctx) {
    throw new Error(
      "useNavigationHistory must be used within a NavigationHistoryProvider"
    );
  }
  return ctx;
}
