import React from "react";
import ReactDOMServer from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PwaUpdateBanner } from "../shared/PwaUpdateBanner";
import { usePwaLifecycle } from "../../hooks/usePwaLifecycle";

const LifecycleProbe: React.FC = () => {
  const pwa = usePwaLifecycle();
  return (
    <div data-standalone={String(pwa.isStandalone)} data-install={String(pwa.canInstall)} />
  );
};

describe("PwaUpdateBanner & usePwaLifecycle SSR safety", () => {
  it("renders nothing when visible is false", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PwaUpdateBanner visible={false} onReload={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(html).toBe("");
  });

  it("renders update prompt in idle state", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PwaUpdateBanner visible={true} onReload={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(html).toContain("New CyberCantina version ready");
    expect(html).toContain("Reload");
    expect(html).toContain("Dismiss update notification");
  });

  it("renders streaming caution copy when isStreaming is true", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PwaUpdateBanner
        visible={true}
        isStreaming={true}
        onReload={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(html).toContain("A turn is currently streaming");
  });

  it("disables action buttons while isUpdating is true", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PwaUpdateBanner
        visible={true}
        isUpdating={true}
        onReload={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(html).toContain("Reloading…");
    expect(html).toContain("disabled");
  });

  it("evaluates usePwaLifecycle safely in Node SSR", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<LifecycleProbe />);
    expect(html).toContain('data-standalone="false"');
    expect(html).toContain('data-install="false"');
  });
});
